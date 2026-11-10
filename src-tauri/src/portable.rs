//! Portable project discovery and project-relative workspace preferences.
use serde_json::{json, Value};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

pub const MARKER: &str = "tfc-project.json";
const PREFERENCE: &str = ".tfc/workspace-selection.json";

fn marker_default(root: &Path) -> Result<String, String> {
    let marker = root.join(MARKER);
    if !marker.exists() {
        return Ok("Workspace".into());
    }
    let value: Value = serde_json::from_slice(&fs::read(marker).map_err(|e| e.to_string())?)
        .map_err(|e| format!("项目标识文件无效：{e}"))?;
    if value["format"] != "tfc-portable-project" || value["schema_version"] != 1 {
        return Err("不支持的便携项目格式，未改用其它位置".into());
    }
    Ok(value["default_workspace"]
        .as_str()
        .ok_or("项目未设置默认工作区")?
        .into())
}

pub fn project_root(executable: &Path, development: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(root) = development {
        marker_default(root)?;
        return root.canonicalize().map_err(|e| e.to_string());
    }
    if executable
        .components()
        .any(|p| p.as_os_str() == "AppTranslocation")
    {
        return Err("macOS 正在隔离位置运行应用，无法确定固态盘项目位置。请在工作区设置中选择 OptiLayer 项目文件夹。".into());
    }
    // Use the .app's parent on macOS; never store data inside its signed bundle.
    let anchor = executable
        .ancestors()
        .find(|p| p.extension().is_some_and(|e| e == "app"))
        .and_then(Path::parent)
        .or_else(|| executable.parent())
        .ok_or("无法定位程序所在目录")?;
    for candidate in anchor.ancestors() {
        if candidate.join(MARKER).exists() {
            marker_default(candidate)?;
            return candidate.canonicalize().map_err(|e| e.to_string());
        }
    }
    if anchor.file_name().is_some_and(|n| n == "Applications") {
        return Err(
            "应用位于 Applications，尚未关联便携项目。请在工作区设置中选择 OptiLayer 项目文件夹。".into(),
        );
    }
    // A standalone client uses its enclosing folder, never AppData or cwd.
    anchor
        .canonicalize()
        .map_err(|e| format!("项目目录不可用：{e}"))
}

pub fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty()
        || relative.contains(['\\', ':'])
        || relative.starts_with('/')
        || relative
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..")
    {
        return Err("工作区位置必须是项目文件夹内的相对路径".into());
    }
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut target = canonical_root.clone();
    for part in Path::new(relative).components() {
        if !matches!(part, Component::Normal(_)) {
            return Err("工作区相对路径无效".into());
        }
        target.push(part);
        match fs::symlink_metadata(&target) {
            Ok(_) => {
                target = target.canonicalize().map_err(|e| e.to_string())?;
                if !target.starts_with(&canonical_root) {
                    return Err("工作区不能通过链接指向项目目录外".into());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    if target == canonical_root {
        return Err("请选择项目内的工作区子文件夹".into());
    }
    Ok(target)
}

pub fn relative(root: &Path, workspace: &Path) -> Result<String, String> {
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let target = workspace.canonicalize().map_err(|e| e.to_string())?;
    let rel = target
        .strip_prefix(&canonical_root)
        .map_err(|_| "请选择项目文件夹内的工作区；外部旧数据请使用“迁入工作区”复制")?;
    let text = rel
        .components()
        .map(|c| c.as_os_str().to_str().ok_or("目录名称必须支持 UTF-8"))
        .collect::<Result<Vec<_>, _>>()?
        .join("/");
    resolve(root, &text)?;
    Ok(text)
}

pub fn selected(root: &Path) -> Result<(PathBuf, bool), String> {
    let file = resolve(root, PREFERENCE)?;
    if file.exists() {
        let value: Value = serde_json::from_slice(&fs::read(file).map_err(|e| e.to_string())?)
            .map_err(|e| format!("项目工作区设置无效：{e}"))?;
        if value["schema_version"] != 1 {
            return Err("不支持的项目工作区设置版本".into());
        }
        let text = value["workspace_relative"]
            .as_str()
            .ok_or("项目设置缺少工作区相对位置")?;
        // A remembered but missing workspace must not be recreated silently.
        return Ok((resolve(root, text)?, false));
    }
    Ok((resolve(root, &marker_default(root)?)?, true))
}

pub fn remember(root: &Path, workspace: &Path) -> Result<(), String> {
    let rel = relative(root, workspace)?;
    let file = resolve(root, PREFERENCE)?;
    fs::create_dir_all(file.parent().ok_or("项目配置目录无效")?).map_err(|e| e.to_string())?;
    fs::write(
        file,
        serde_json::to_vec_pretty(&json!({"schema_version":1,"workspace_relative":rel}))
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("项目文件夹不可写，无法记住工作区：{e}"))
}


// Explorer uses Shell paths, whereas canonical filesystem paths may carry a
// verbatim prefix. Convert only the presentation passed to Explorer.
#[cfg(any(windows, test))]
pub fn explorer_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{unc}"))
    } else if let Some(drive) = text.strip_prefix(r"\\?\") {
        PathBuf::from(drive)
    } else { path.to_path_buf() }
}

#[cfg(test)]
mod tests {
    #[test]
    fn explorer_receives_shell_paths_for_drives_and_unc() {
        assert_eq!(super::explorer_path(std::path::Path::new(r"\\?\E:\中文 固态盘\Workspace")),std::path::PathBuf::from(r"E:\中文 固态盘\Workspace"));
        assert_eq!(super::explorer_path(std::path::Path::new(r"\\?\UNC\server\共享\Workspace")),std::path::PathBuf::from(r"\\server\共享\Workspace"));
        assert_eq!(super::explorer_path(std::path::Path::new(r"E:\正常\Workspace")),std::path::PathBuf::from(r"E:\正常\Workspace"));
    }

    use super::*;
    static NEXT_FOLDER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    struct Folder(PathBuf);
    impl Folder {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "tfc-portable-{}-{}-{}",
                std::process::id(),
                NEXT_FOLDER.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn marker(root: &Path) {
        fs::write(root.join(MARKER), r#"{"format":"tfc-portable-project","schema_version":1,"default_workspace":"Workspace"}"#).unwrap();
    }
    #[test]
    fn mac_and_windows_clients_discover_the_same_project() {
        let f = Folder::new();
        marker(&f.0);
        let mac = f.0.join("macOS/TFC.app/Contents/MacOS/TFC");
        let windows = f.0.join("Windows/TFC.exe");
        fs::create_dir_all(mac.parent().unwrap()).unwrap();
        fs::create_dir_all(windows.parent().unwrap()).unwrap();
        assert_eq!(
            project_root(&mac, None).unwrap(),
            f.0.canonicalize().unwrap()
        );
        assert_eq!(
            project_root(&windows, None).unwrap(),
            f.0.canonicalize().unwrap()
        );
    }
    #[test]
    fn project_move_preserves_relative_selection() {
        let f = Folder::new();
        let first = f.0.join("原项目");
        fs::create_dir(&first).unwrap();
        marker(&first);
        let workspace = first.join("Workspaces/中文 空格");
        fs::create_dir_all(&workspace).unwrap();
        remember(&first, &workspace).unwrap();
        let text = fs::read_to_string(first.join(PREFERENCE)).unwrap();
        assert!(!text.contains(first.to_str().unwrap()));
        assert!(!text.contains("workspace_root"));
        let moved = f.0.join("模拟新盘符项目");
        fs::rename(&first, &moved).unwrap();
        assert_eq!(
            selected(&moved).unwrap(),
            (
                moved.join("Workspaces/中文 空格").canonicalize().unwrap(),
                false
            )
        );
    }
    #[test]
    fn default_and_missing_saved_selection_have_different_creation_policy() {
        let f = Folder::new();
        marker(&f.0);
        assert_eq!(
            selected(&f.0).unwrap(),
            (f.0.canonicalize().unwrap().join("Workspace"), true)
        );
        let workspace = f.0.join("Workspace");
        fs::create_dir(&workspace).unwrap();
        remember(&f.0, &workspace).unwrap();
        fs::remove_dir(&workspace).unwrap();
        assert!(!selected(&f.0).unwrap().1);
        assert!(!workspace.exists());
    }
    #[test]
    fn absolute_paths_escapes_and_external_choices_are_rejected() {
        let f = Folder::new();
        for text in [
            "/tmp/data",
            "../data",
            "C:/data",
            "C:\\data",
            "//server/share",
            "a/../b",
            ".",
            "a//b",
            "",
        ] {
            assert!(resolve(&f.0, text).is_err(), "{text}");
        }
        let outside = Folder::new();
        assert!(relative(&f.0, &outside.0).is_err());
    }
    #[test]
    fn bad_project_or_preferences_never_fall_back_to_machine_storage() {
        let f = Folder::new();
        fs::write(f.0.join(MARKER), r#"{"schema_version":100}"#).unwrap();
        assert!(selected(&f.0).is_err());
        marker(&f.0);
        fs::create_dir(f.0.join(".tfc")).unwrap();
        fs::write(
            f.0.join(PREFERENCE),
            r#"{"workspace_root":"C:/old-device/data"}"#,
        )
        .unwrap();
        assert!(selected(&f.0).is_err());
    }
    #[test]
    fn mac_isolated_and_applications_launches_need_explicit_location() {
        let f = Folder::new();
        let isolated =
            f.0.join("AppTranslocation/uuid/d/TFC.app/Contents/MacOS/tfc");
        fs::create_dir_all(isolated.parent().unwrap()).unwrap();
        assert!(project_root(&isolated, None).unwrap_err().contains("隔离"));
        let installed = f.0.join("Applications/TFC.app/Contents/MacOS/tfc");
        fs::create_dir_all(installed.parent().unwrap()).unwrap();
        assert!(project_root(&installed, None).unwrap_err().contains("选择"));
    }
    #[test]
    fn standalone_mac_uses_app_parent_and_windows_uses_executable_parent() {
        let f = Folder::new();
        let mac = f.0.join("TFC.app/Contents/MacOS/tfc");
        fs::create_dir_all(mac.parent().unwrap()).unwrap();
        assert_eq!(
            project_root(&mac, None).unwrap(),
            f.0.canonicalize().unwrap()
        );
        assert_eq!(
            project_root(&f.0.join("TFC.exe"), None).unwrap(),
            f.0.canonicalize().unwrap()
        );
    }
    #[cfg(unix)]
    #[test]
    fn linked_folder_cannot_escape_the_project() {
        let f = Folder::new();
        let outside = Folder::new();
        std::os::unix::fs::symlink(&outside.0, f.0.join("link")).unwrap();
        assert!(resolve(&f.0, "link/data").is_err());
    }
}
