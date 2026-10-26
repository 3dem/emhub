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
  stepsDone: string;
  numberOfSteps: string;
  outputs: any;
  inputs: any;
  tags: string[];
}