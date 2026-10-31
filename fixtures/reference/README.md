# TFD / optical-engine reference fixture

用于 Codex 开发 `.tfd` 解析器和薄膜光谱计算模块的自包含测试样例。

## 文件
- `reference_4layer_550nm.tfd` — 膜系文本
- `reference_settings.json` — 所有计算假设和材料常数
- `reference_4layer_550nm_spectrum.csv` — 400–700 nm，1 nm步长的 golden spectrum
- `README.md` — 本说明

## 设计
参考波长 550 nm，0°入射，AIR -> coating -> GLASS。
TFD 中 Layer 1 靠近基底；光从空气侧入射时遍历顺序为 4 -> 3 -> 2 -> 1。

| Layer | Material | QWOT | Physical thickness |
|---|---|---:|---:|
|1|TA2O5_REF|1.0|65.476190 nm|
|2|SIO2_REF|1.0|94.178082 nm|
|3|TA2O5_REF|1.0|65.476190 nm|
|4|SIO2_REF|1.0|94.178082 nm|

材料常数：TA2O5_REF n=2.10, SIO2_REF n=1.46, GLASS n=1.52, AIR n=1.0；全部 k=0。
本样例故意不使用色散，便于精确单元测试；不计算基底背面反射。

## 计算
δ = 2πnd/λ

M_j = [[cosδ, i·sinδ/n],
       [i·n·sinδ, cosδ]]

总矩阵按光传播方向相乘，然后求振幅反射/透射系数并换算 R/T。
无吸收时 R+T 应为 100%。

## Golden checkpoints
| wavelength | R | T |
|---:|---:|---:|
| 400 | 17.472419% | 82.527581% |
| 450 | 27.360367% | 72.639633% |
| 500 | 24.884006% | 75.115994% |
| 550 | 22.646334% | 77.353666% |
| 600 | 24.297786% | 75.702214% |
| 650 | 26.665145% | 73.334855% |
| 700 | 27.419262% | 72.580738% |

## Codex 验收建议
先只解析 `ENVIRON`、`LAYERS`、`LAYER`。计算模块从 JSON 读取 n/k，不要尝试在 TFCalc 材料库查找 `*_REF`。
CSV 作为 golden data；建议初版在上述假设完全一致时，把 R/T 误差做到 <= 1e-5 percentage point。
之后再接真实材料的 n(λ)、k(λ)、斜入射、S/P偏振、基底背面和 TFCalc 兼容字段。
