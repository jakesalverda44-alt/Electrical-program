export const PC_STEPS = [
  { key: 'intake',    label: 'Intake',          short: '1' },
  { key: 'takeoff',   label: 'Plan Review',     short: '2' },
  { key: 'scope',     label: 'Scope of Work',   short: '3' },
  { key: 'estimate',  label: 'Estimate',        short: '4' },
  { key: 'review',    label: 'Internal Review', short: '5' },
  { key: 'proposal',  label: 'Proposal',        short: '6' },
  { key: 'submitted', label: 'Submitted',       short: '7' },
] as const;

export type PcStepKey = typeof PC_STEPS[number]['key'];

export const PC_TABS = [
  { key: 'overview',   label: 'Overview'          },
  { key: 'files',      label: 'Files'             },
  { key: 'bid',        label: 'Bid Builder'       },
  { key: 'takeoff',    label: 'Plan Review'       },
  { key: 'scope',      label: 'Scope of Work'     },
  { key: 'rfis',       label: 'RFIs'              },
  { key: 'proposal',   label: 'Proposal'          },
  { key: 'costs',      label: 'Historical Costs'  },
  { key: 'intel',      label: 'Bid Intelligence'  },
] as const;

export type PcTabKey = typeof PC_TABS[number]['key'];

export const SCOPE_SECS = [
  { id: 'A', label: 'Service & Distribution' },
  { id: 'B', label: 'Branch Circuits'        },
  { id: 'C', label: 'Lighting'               },
  { id: 'D', label: 'Low Voltage / Data'     },
  { id: 'E', label: 'Fire Alarm'             },
  { id: 'F', label: 'Site / Exterior'        },
  { id: 'G', label: 'Special Systems'        },
];

export interface PcWorkspace {
  bidId: string;
  bidName: string;
  step: PcStepKey;
  activeTab: PcTabKey;
  files: { id: string; name: string; type: string; size: string }[];
  aiLog: string[];
  aiRunning: boolean;
  aiDone: boolean;
  scope: Record<string, string>;
  rfis: { id: string; question: string; submitted: boolean; answer: string }[];
  proposalGenerated: boolean;
  notes: string;
  amount: number;
}

export function blankWorkspace(bidId: string, bidName: string, amount: number): PcWorkspace {
  return {
    bidId, bidName, amount,
    step: 'intake', activeTab: 'overview',
    files: [], aiLog: [], aiRunning: false, aiDone: false,
    scope: {}, rfis: [], proposalGenerated: false, notes: '',
  };
}
