export type MaterialRole = "film" | "substrate" | "medium" | "all";
export type Polarization = "s" | "p" | "unpolarized";
export interface Material {
  name: string;
  n: number;
  k: number;
  color: string;
  role: MaterialRole;
  model: "constant" | "tabulated" | "tfcalc-formula";
  samples?: number[][];
  range_nm?: [number, number];
  formula?: {
    n_type: number;
    k_type: number;
    coefficients: number[];
    k_coefficients: number[];
    wavelength_unit: string;
  };
  display_name?: string;
  collection?: string;
  provenance?: {
    path: string;
    sha256: string;
    encoding: string;
    comments: string[];
  };
  status?: "ready" | "quarantined";
  issues?: string[];
  catalogue_summary?: boolean;
  point_count?: number;
  preview_nm?: number;
  preview?: number[][];
  duplicate_of?: string;
  source: string;
}
export interface Layer {
  id: string;
  material: string;
  thickness_nm: number;
}
export interface Settings {
  start_nm: number;
  end_nm: number;
  step_nm: number;
  reference_nm: number;
  angle_deg: number;
  polarization: Polarization;
  incident_n: number;
  substrate_n: number;
  incident_material: string;
  substrate_material: string;
}
export interface Band {
  start_nm: number;
  end_nm: number;
}
export interface AnalysisBands {
  passband?: Band;
  stopband?: Band;
}
export interface TargetPoint {
  wavelength_nm: number;
  T_percent?: number;
  R_percent?: number;
}
export interface Project {
  import_info?: {
    format: "TFCalc";
    file_name: string;
    encoding: string;
    text_sha256: string;
    materials: { role: string; original: string; resolved: string }[];
    source_layers: {
      index: number;
      material: string;
      physical_nm: number;
      group: number;
      factor: number;
    }[];
    notes: string[];
  };
  schema_version: 1;
  id: string;
  name: string;
  layer_order: "substrate_to_air";
  settings: Settings;
  materials: Material[];
  layers: Layer[];
  analysis_bands?: AnalysisBands;
  target_points?: TargetPoint[];
}
export interface SpectralPoint {
  wavelength_nm: number;
  value_percent: number;
}
export interface ChannelAnalysis {
  min: SpectralPoint;
  max: SpectralPoint;
  mean_percent: number;
  peaks: SpectralPoint[];
  valleys: SpectralPoint[];
}
export interface Crossing {
  wavelength_nm: number;
  direction: "rising" | "falling";
}
export interface Edge {
  direction: "rising" | "falling";
  start_nm: number;
  end_nm: number;
  cutoff_50_nm: number;
  width_nm: number;
  slope_percent_per_nm: number;
}
export interface BandResult {
  start_nm?: number;
  end_nm?: number;
  mean_percent?: number;
  error?: string;
}
export interface SpectrumAnalysis {
  T: ChannelAnalysis;
  R: ChannelAnalysis;
  crossings: Record<string, Crossing[]>;
  edges: Edge[];
  passband_T: BandResult | null;
  stopband_T: BandResult | null;
  stopband_R: BandResult | null;
  note: string;
}
export interface RTPoint {
  wavelength_nm: number;
  R_percent: number;
  T_percent: number;
  A_percent: number;
  energy_error: number;
}
export interface Spectrum {
  wavelength_nm: number[];
  R_percent: number[];
  T_percent: number[];
  A_percent: number[];
  Rs_percent: number[];
  Rp_percent: number[];
  Ts_percent: number[];
  Tp_percent: number[];
  absorbing?: boolean;
  warnings?: string[];
  energy_check?: string;
  max_energy_error: number;
  energy_error: number[];
  model: string;
  analysis: SpectrumAnalysis;
  analysis_bands?: AnalysisBands;
  input_snapshot: Project;
  reference_point: RTPoint;
}
export interface SavedProject {
  id: string;
  name: string;
  updated_at: string;
}

export interface WorkspaceInfo {
  project_root?: string;
  relative_path?: string;
  location_mode?: "project-relative";
  id: string;
  name: string;
  root: string;
  schema_version: number;
  directories: Record<string, string>;
  units: Record<string, string>;
}
