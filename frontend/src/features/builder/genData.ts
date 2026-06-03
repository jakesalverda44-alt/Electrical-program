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

// Thin spec used only for genModelNo() in genCalc
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

export interface GenSpecDetail {
  model: string;
  engine: string;
  displacement: string;
  rpm: string;
  voltage: string;
  amps_lp: string;
  amps_ng: string;
  breaker: string;
  weight: string;
  dims: string;
  sound: string;
  fuel_ng_full: string;
  fuel_ng_half: string;
  fuel_lp_full: string;
  fuel_lp_half: string;
  warranty: string;
  wind: string;
  controller: string;
  certs: string;
  features: string[];
}

export const GEN_SPEC_DETAIL: Record<string, Record<string, GenSpecDetail>> = {
  Kohler: {
    '14KW': {
      model: '14RCA', engine: 'Kohler Command PRO CH740 V-Twin', displacement: '725 cc (44 cu in)',
      rpm: '3,600', voltage: '120/240V, Single Phase', amps_lp: '59A', amps_ng: '50A', breaker: '70A',
      weight: '385 lbs', dims: '48 × 25 × 29 in', sound: '69 dB(A) at 23 ft', wind: '181 MPH',
      fuel_ng_full: '193 CFH', fuel_ng_half: '124 CFH', fuel_lp_full: '2.3 gal/hr', fuel_lp_half: '1.8 gal/hr',
      warranty: '5-Year / 2,000-Hour', controller: 'RDC2 with OnCue Plus', certs: 'UL 2200, EPA, CARB',
      features: [
        'Kohler Command PRO OHV engine with hydraulic valve lifters',
        'PowerBoost™ technology — starts & runs 5-ton A/C',
        'Aluminum enclosure, corrosion-proof, tool-free panel removal',
        'Digital voltage regulation ±1.0% RMS / THD < 5%',
        'RDC2 controller manages generator & RXT transfer switch',
        'Weekly exercise mode with full system diagnostics',
        'OnCue® Plus Generator Management System included',
        'Field convertible: Natural Gas or LP / Meets 181 MPH wind rating',
      ],
    },
    '20KW': {
      model: '20RCA', engine: 'Kohler Command PRO CH1000 V-Twin', displacement: '999 cc (61 cu in)',
      rpm: '3,600', voltage: '120/240V, Single Phase', amps_lp: '84A', amps_ng: '75A', breaker: '100A',
      weight: '420 lbs', dims: '48 × 25 × 29 in', sound: '70 dB(A) at 23 ft', wind: '181 MPH',
      fuel_ng_full: '281 CFH', fuel_ng_half: '185 CFH', fuel_lp_full: '3.7 gal/hr', fuel_lp_half: '2.2 gal/hr',
      warranty: '5-Year / 2,000-Hour', controller: 'RDC2 with OnCue Plus', certs: 'UL 2200, EPA, CARB',
      features: [
        'Kohler Command PRO OHV engine with hydraulic valve lifters',
        'PowerBoost™ technology — starts & runs 5-ton A/C',
        'Aluminum enclosure, corrosion-proof, tool-free panel removal',
        'Digital voltage regulation ±1.0% RMS / THD < 5%',
        'RDC2 controller manages generator & RXT transfer switch',
        'Weekly/bi-weekly/monthly exercise modes',
        'OnCue® Plus Generator Management System included',
        'Field convertible: Natural Gas or LP / Meets 181 MPH wind rating',
      ],
    },
    '26KW': {
      model: '26RCA', engine: 'Kohler Command PRO CH1006 V-Twin', displacement: '999 cc (61 cu in)',
      rpm: '3,600', voltage: '120/240V, Single Phase', amps_lp: '109A', amps_ng: '100A', breaker: '125A',
      weight: '450 lbs', dims: '48 × 25 × 29 in', sound: '70 dB(A) at 23 ft', wind: '181 MPH',
      fuel_ng_full: '335 CFH', fuel_ng_half: '220 CFH', fuel_lp_full: '4.4 gal/hr', fuel_lp_half: '2.8 gal/hr',
      warranty: '5-Year / 2,000-Hour', controller: 'RDC2 with OnCue Plus', certs: 'UL 2200, EPA, CARB',
      features: [
        'Kohler Command PRO OHV engine with hydraulic valve lifters',
        'PowerBoost™ technology — starts & runs 5-ton A/C',
        'Aluminum enclosure, corrosion-proof, tool-free panel removal',
        'Digital voltage regulation ±1.0% RMS / THD < 5%',
        'EcoExercise 90-second low-impact mode',
        'Weekly/bi-weekly/monthly exercise intervals',
        'OnCue® Plus Generator Management System included',
        'Field convertible: Natural Gas or LP / Meets 181 MPH wind rating',
      ],
    },
  },
  Generac: {
    '14KW': {
      model: 'Guardian 7223', engine: 'Generac G-Force 800 V-Twin', displacement: '816 cc',
      rpm: '3,600', voltage: '120/240V, Single Phase', amps_lp: '58.3A', amps_ng: '58.3A', breaker: '60A',
      weight: '385 lbs', dims: '48 × 25 × 29 in', sound: '65 dB(A) at 23 ft', wind: '150 MPH',
      fuel_ng_full: '256 CFH', fuel_ng_half: '195 CFH', fuel_lp_full: '3.07 gal/hr', fuel_lp_half: '1.81 gal/hr',
      warranty: '5-Year Limited', controller: 'Evolution™ LCD + Mobile Link Wi-Fi', certs: 'UL 2200, ETL, EPA',
      features: [
        'Generac G-Force 800 Series V-Twin engine',
        'True Power™ Electrical Technology — THD < 5%',
        'Solid-state voltage regulation ±1%',
        'Evolution™ controller with multilingual LCD',
        'Mobile Link Wi-Fi remote monitoring included',
        'Quiet-Test™ low-speed exercise mode at 55 dB(A)',
        'Sound attenuated enclosure, 150 MPH wind rated',
        'Field convertible: Natural Gas or LP',
      ],
    },
    '18KW': {
      model: 'Guardian 7226', engine: 'Generac G-Force 800 V-Twin', displacement: '816 cc',
      rpm: '3,600', voltage: '120/240V, Single Phase', amps_lp: '75.0A', amps_ng: '70.8A', breaker: '80A',
      weight: '420 lbs', dims: '48 × 25 × 29 in', sound: '65 dB(A) at 23 ft', wind: '150 MPH',
      fuel_ng_full: '247 CFH', fuel_ng_half: '169 CFH', fuel_lp_full: '3.02 gal/hr', fuel_lp_half: '1.70 gal/hr',
      warranty: '5-Year Limited', controller: 'Evolution™ LCD + Mobile Link Wi-Fi', certs: 'UL 2200, ETL, EPA',
      features: [
        'Generac G-Force 800 Series V-Twin engine',
        'True Power™ Electrical Technology — THD < 5%',
        'Solid-state voltage regulation ±1%',
        'Evolution™ controller with multilingual LCD',
        'Mobile Link Wi-Fi remote monitoring included',
        'Quiet-Test™ low-speed exercise mode',
        'Sound attenuated enclosure, 150 MPH wind rated',
        'Field convertible: Natural Gas or LP',
      ],
    },
    '22KW': {
      model: 'Guardian 7042', engine: 'Generac G-Force 992 V-Twin', displacement: '992 cc',
      rpm: '3,600', voltage: '120/240V, Single Phase', amps_lp: '91.7A', amps_ng: '91.7A', breaker: '100A',
      weight: '490 lbs', dims: '48 × 25 × 29 in', sound: '67 dB(A) at 23 ft', wind: '150 MPH',
      fuel_ng_full: '303 CFH', fuel_ng_half: '196 CFH', fuel_lp_full: '3.60 gal/hr', fuel_lp_half: '2.30 gal/hr',
      warranty: '5-Year Limited', controller: 'Power Zone™ 200 + Mobile Link Cellular', certs: 'UL 2200, ETL, EPA',
      features: [
        'Generac G-Force 992 V-Twin with EFIC',
        'Electronic Fuel & Ignition Control (EFIC)',
        'True Power™ Electrical Technology — THD < 5%',
        'Hydraulic lifters — no valve adjustment required',
        'Power Zone™ 200 controller with LED indicators',
        'Mobile Link Cellular remote monitoring standard',
        'Oil level sensor — continuous monitoring',
        'Sound attenuated enclosure, 150 MPH wind rated',
      ],
    },
    '24KW': {
      model: 'Guardian 7209', engine: 'Generac G-Force 992 V-Twin', displacement: '992 cc',
      rpm: '3,600', voltage: '120/240V, Single Phase', amps_lp: '100A', amps_ng: '100A', breaker: '100A',
      weight: '490 lbs', dims: '48 × 25 × 29 in', sound: '67 dB(A) at 23 ft', wind: '150 MPH',
      fuel_ng_full: '330 CFH', fuel_ng_half: '210 CFH', fuel_lp_full: '3.80 gal/hr', fuel_lp_half: '2.40 gal/hr',
      warranty: '5-Year Limited', controller: 'Power Zone™ 200 + Mobile Link Cellular', certs: 'UL 2200, ETL, EPA',
      features: [
        'Generac G-Force 992 V-Twin with EFIC',
        'Electronic Fuel & Ignition Control (EFIC)',
        'True Power™ Electrical Technology — THD < 5%',
        'Hydraulic lifters — no valve adjustment required',
        'Power Zone™ 200 controller with LED indicators',
        'Mobile Link Cellular remote monitoring standard',
        'Oil level sensor — continuous monitoring',
        'Sound attenuated enclosure, 150 MPH wind rated',
      ],
    },
    '26KW': {
      model: 'Guardian 7290', engine: 'Generac G-Force 992 V-Twin', displacement: '992 cc',
      rpm: '3,600', voltage: '120/240V, Single Phase', amps_lp: '108.3A', amps_ng: '104.2A', breaker: '125A',
      weight: '510 lbs', dims: '48 × 25 × 29 in', sound: '67 dB(A) at 23 ft', wind: '150 MPH',
      fuel_ng_full: '355 CFH', fuel_ng_half: '225 CFH', fuel_lp_full: '4.10 gal/hr', fuel_lp_half: '2.60 gal/hr',
      warranty: '5-Year Limited', controller: 'Evolution™ + Mobile Link Wi-Fi', certs: 'UL 2200, ETL, EPA',
      features: [
        'Generac G-Force 992 V-Twin engine',
        'True Power™ Electrical Technology — THD < 5%',
        'Solid-state voltage regulation ±1%',
        'Mobile Link Wi-Fi remote monitoring',
        'Sound attenuated enclosure, 150 MPH wind rated',
        'Field convertible: Natural Gas or LP',
        'EPA certified for non-emergency applications',
        '2-year/200-hour oil change interval',
      ],
    },
    '28KW': {
      model: 'Guardian 7282', engine: 'Generac G-Force 999 V-Twin', displacement: '999 cc',
      rpm: '3,600', voltage: '120/240V, Single Phase', amps_lp: '116.7A', amps_ng: '112.5A', breaker: '125A',
      weight: '530 lbs', dims: '48 × 25 × 29 in', sound: '68 dB(A) at 23 ft', wind: '150 MPH',
      fuel_ng_full: '380 CFH', fuel_ng_half: '245 CFH', fuel_lp_full: '4.40 gal/hr', fuel_lp_half: '2.80 gal/hr',
      warranty: '5-Year Limited', controller: 'Power Zone™ 200 + Mobile Link Cellular', certs: 'UL 2200, ETL, EPA',
      features: [
        'Generac G-Force 999 V-Twin with EFIC',
        'Electronic Fuel & Ignition Control (EFIC)',
        'True Power™ Electrical Technology — THD < 5%',
        'Hydraulic lifters — no valve adjustment required',
        'Power Zone™ 200 controller with LED indicators',
        'Mobile Link Cellular remote monitoring standard',
        'Oil level sensor — continuous monitoring',
        'ecobee by Generac Smart Thermostat compatible',
      ],
    },
  },
};

export interface GenForm {
  customer: string;
  attn: string;
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
  discountType: '%' | '$';
  taxRate: number;
  notes: string;
  includeBreakdown: boolean;
  jobType: 'new-install' | 'swap-out';
  removalFee: number;
}
