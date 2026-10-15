// Messages between the UI thread and job workers. Buffers are always
// moved (transferred), never copied, so a file exists in one place at a time.

export type JobRequest = {
  id: string;
  kind: 'inspect';
  buffer: ArrayBuffer;
};

export type JobResult =
  | { id: string; ok: true; buffer: ArrayBuffer; isPdf: boolean; bytes: number }
  | { id: string; ok: false; error: string };
