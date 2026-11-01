import type { Spectrum } from "./types";
export function spectrumCsv(result: Spectrum): string {
  return (
    "\ufeffwavelength_nm,R_percent,T_percent,A_percent,Rs_percent,Rp_percent,Ts_percent,Tp_percent,energy_error\n" +
    result.wavelength_nm
      .map((w, i) =>
        [
          w,
          result.R_percent[i],
          result.T_percent[i],
          result.A_percent[i],
          result.Rs_percent[i],
          result.Rp_percent[i],
          result.Ts_percent[i],
          result.Tp_percent[i],
          result.energy_error[i],
        ].join(","),
      )
      .join("\n")
  );
}
