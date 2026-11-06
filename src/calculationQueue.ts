import { physicalSignature } from "./model.ts";
import type { Project, Spectrum } from "./types.ts";
/** One running engine request, one replaceable pending request. Old results never publish. */
export class CalculationQueue {
  private revision = 0;
  private scopeRevision = 0;
  private lastKey = "";
  private pending: {
    project: Project;
    revision: number;
    scopeRevision: number;
  } | null = null;
  private running = false;
  private compute: (project: Project) => Promise<Spectrum>;
  private result: (s: Spectrum, p: Project) => void;
  private error: (e: unknown) => void;
  private activity: (busy: boolean) => void;
  private preview?: (s: Spectrum, p: Project) => void;
  constructor(
    compute: (project: Project) => Promise<Spectrum>,
    result: (s: Spectrum, p: Project) => void,
    error: (e: unknown) => void,
    activity: (busy: boolean) => void,
    preview?: (s: Spectrum, p: Project) => void,
  ) {
    this.compute = compute;
    this.result = result;
    this.error = error;
    this.activity = activity;
    this.preview = preview;
  }
  submit(project: Project, force = false) {
    const key = project.id + physicalSignature(project);
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.pending = {
      project: structuredClone(project),
      scopeRevision: this.scopeRevision,
      revision: ++this.revision,
    };
    if (!this.running) void this.pump();
  }
  reset() {
    ++this.scopeRevision;
    this.invalidate();
  }
  invalidate() {
    this.lastKey = "";
    ++this.revision;
    this.pending = null;
  }
  private queuedJob() {
    return this.pending;
  }
  private async pump() {
    this.running = true;
    this.activity(true);
    while (this.pending) {
      const job = this.pending;
      this.pending = null;
      try {
        const result = await this.compute(job.project);
        const newer = this.queuedJob();
        if (job.revision === this.revision) this.result(result, job.project);
        else if (
          newer &&
          newer.project.id === job.project.id &&
          job.scopeRevision === this.scopeRevision
        )
          this.preview?.(result, job.project);
      } catch (error) {
        if (job.revision === this.revision) this.error(error);
      }
    }
    this.running = false;
    this.activity(false);
  }
}
