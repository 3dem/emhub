export interface ProtocolNode {
  id: string;
  parents: string[];
  children: string[];
  label: string;
  title: string;
  runName: string;
  comment: string; 
  status: string;
  parameters: Record<string, any>;
  cpuTime: string;
  elapsedTime: string;
  // Changes with every new run (restarts the local elapsed timer)
  elapsedSessionId?: string;
  elapsedRuns?: ProtocolRunTiming[];
  // Pending launch (no run started yet) and its time in the queue (seconds)
  launched?: string;
  queued?: number | null;
  stepsDone: string;
  numberOfSteps: string;
  outputs: any;
  inputs: any;
  tags: string[];
}
// Timing of one run of a protocol, elapsed and queued (from launched to
// start) are in seconds (null when unknown, e.g. the job was killed)
export interface ProtocolRunTiming {
  launched?: string;
  queued?: number | null;
  start?: string;
  end?: string;
  elapsed?: number | null;
  status?: string;
}
