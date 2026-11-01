import { physicalSignature } from "./model.ts";
import type { Project, Spectrum } from "./types.ts";
/** One running engine request, one replaceable pending request. Old results never publish. */
export class CalculationQueue {
  private revision = 0;
  private lastKey = "";
  private pending: { project: Project; revision: number } | null = null;
  private running = false;
  private compute: (project: Project) => Promise<Spectrum>;
  private result: (s: Spectrum, p: Project) => void;
  private error: (e: unknown) => void;
  private activity: (busy: boolean) => void;
  constructor(
    compute: (project: Project) => Promise<Spectrum>,
    result: (s: Spectrum, p: Project) => void,
    error: (e: unknown) => void,
    activity: (busy: boolean) => void,
  ) {
    this.compute = compute;
    this.result = result;
    this.error = error;
    this.activity = activity;
  }
  submit(project: Project, force = false) {
    const key = project.id + physicalSignature(project);
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.pending = {
      project: structuredClone(project),
      revision: ++this.revision,
    };
    if (!this.running) void this.pump();
  }
  invalidate() {
    this.lastKey = "";
    ++this.revision;
    this.pending = null;
  }
  private async pump() {
    this.running = true;
    this.activity(true);
    while (this.pending) {
      const job = this.pending;
      this.pending = null;
      try {
        const result = await this.compute(job.project);
        if (job.revision === this.revision) this.result(result, job.project);
      } catch (error) {
        if (job.revision === this.revision) this.error(error);
      }
    }
    this.running = false;
    this.activity(false);
  }
}
