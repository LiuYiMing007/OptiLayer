import type { Spectrum } from "./types";
export function spectrumCsv(result: Spectrum): string {
  return (
    "\ufeffwavelength_nm,R_percent,T_percent,A_percent,Rs_percent,Rp_percent,Ts_percent,Tp_percent,energy_error" +
    (result.response_weight
      ? ",response_weight,weighted_R_percent,weighted_T_percent,weighted_A_percent"
      : "") +
    "\n" +
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
          ...(result.response_weight
            ? [
                result.response_weight[i],
                result.weighted_R_percent![i],
                result.weighted_T_percent![i],
                result.weighted_A_percent![i],
              ]
            : []),
        ].join(","),
      )
      .join("\n")
  );
}
