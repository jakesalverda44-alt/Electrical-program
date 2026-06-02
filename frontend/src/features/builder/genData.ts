export const DEFAULT_PRICES = {
  generators: {
    'air-cooled': {
      Kohler:  { '14KW': 5800, '20KW': 6700, '26KW': 8200 },
      Generac: { '14KW': 5600, '18KW': 6450, '22KW': 7150, '24KW': 7575, '26KW': 8000, '28KW': 9300 },
    },
    'liquid-cooled': {
      Kohler:  { '24KW': 17549, '30KW': 19999, '38KW': 22449, '48KW': 25209, '60KW': 27759, '80KW': 34089, '100KW': 41129 },
      Generac: { '32KW': 19203, '40KW': 21734, '48KW': 22914, '60KW': 25212 },
    },
  } as Record<string, Record<string, Record<string, number>>>,
  additionalATS: 1000,
  smm: 250,
  surgePro: 395,
  pad: 485,
  battery: 185,
  labor: 3000,
  permit: 1250,
  startup: 695,
  extraWire: 25,
  padLC_small: 800,
  padLC_large: 1200,
  startupLC: 1595,
  lull: 1100,
  crane: 1800,
  atsLC_150: 1000,
  atsLC_200: 1000,
};

export const LC_MODELS: Record<string, Record<string, string>> = {
  Kohler:  { '24KW': '24RCLA', '30KW': '30RCLA', '38KW': '38RCLC', '48KW': '48RCLC', '60KW': '60RCLB', '80KW': 'KG80R', '100KW': 'KG1004' },
  Generac: { '32KW': 'XG03245ANAX', '40KW': 'XG04045ANAX', '48KW': 'XG04845ANAX', '60KW': 'XG06045ANAX' },
};

export const GEN_SPECS: Record<string, Record<string, { amps?: number; phases?: number }>> = {
  Kohler: {
    '14KW': { amps: 58 }, '20KW': { amps: 83 }, '26KW': { amps: 108 },
    '24KW': { amps: 100 }, '30KW': { amps: 125 }, '38KW': { amps: 158 },
    '48KW': { amps: 200 }, '60KW': { amps: 250 }, '80KW': { amps: 333 }, '100KW': { amps: 417 },
  },
  Generac: {
    '14KW': { amps: 58 }, '18KW': { amps: 75 }, '22KW': { amps: 92 },
    '24KW': { amps: 100 }, '26KW': { amps: 108 }, '28KW': { amps: 117 },
    '32KW': { amps: 133 }, '40KW': { amps: 167 }, '48KW': { amps: 200 }, '60KW': { amps: 250 },
  },
};

export interface GenForm {
  customer: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  brand: 'Kohler' | 'Generac';
  coolingType: 'air-cooled' | 'liquid-cooled';
  size: string;
  ats: string;
  fuel: 'Natural Gas' | 'LP';
  pad: boolean;
  smm: boolean;
  surgePro: boolean;
  battery: boolean;
  extraWire: number;
  liftType: 'none' | 'lull' | 'crane';
  removal: boolean;
  additionalATS: number;
  lcATS: '150A' | '200A' | 'none';
  labor: number;
  permit: number;
  startup: number;
  discount: number;
  taxRate: number;
  notes: string;
}
