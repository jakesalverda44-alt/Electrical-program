// Florida sales-tax auto-fill for the proposal builder.
//
// Florida combined rate = 6% state + county discretionary sales surtax. We resolve the
// county from the address (city first — the address parser gives a clean city — then ZIP)
// and add the county surtax.
//
// ⚠️ VERIFY / UPDATE ANNUALLY: surtax rates are seeded from FL DOR DR-15DSS knowledge
// (~2025) and change each January. Source of truth: Florida DOR Form DR-15DSS. Coverage
// is focused on the Central/North-Central FL service area plus major metros — ask to
// extend it (or correct any rate/ZIP) as needed. Unknown addresses fall back to the
// builder's default rate, so nothing is ever guessed onto a proposal.

export const FL_STATE_RATE = 6;

// County → discretionary surtax (%). Combined rate = FL_STATE_RATE + surtax.
export const FL_COUNTY_SURTAX: Record<string, number> = {
  Alachua: 1.5, Brevard: 1.0, Broward: 1.0, Citrus: 0.0, Collier: 1.0,
  Duval: 1.5, Hernando: 0.5, Hillsborough: 1.5, Lake: 1.0, Lee: 0.5,
  Manatee: 1.0, Marion: 1.5, 'Miami-Dade': 1.0, Orange: 0.5, Osceola: 1.5,
  'Palm Beach': 1.0, Pasco: 1.0, Pinellas: 1.0, Polk: 1.0, Sarasota: 1.0,
  Seminole: 1.0, Sumter: 1.0, Volusia: 0.5,
};

// City (lowercase) → county. Primary signal.
export const FL_CITY_COUNTY: Record<string, string> = {
  // Citrus (0% surtax → 6.0%)
  'crystal river': 'Citrus', inverness: 'Citrus', 'beverly hills': 'Citrus',
  lecanto: 'Citrus', homosassa: 'Citrus', 'homosassa springs': 'Citrus',
  'floral city': 'Citrus', 'citrus springs': 'Citrus', holder: 'Citrus',
  // Lake (1% → 7.0%)
  leesburg: 'Lake', eustis: 'Lake', tavares: 'Lake', 'mount dora': 'Lake', 'mt dora': 'Lake',
  clermont: 'Lake', groveland: 'Lake', minneola: 'Lake', umatilla: 'Lake', 'lady lake': 'Lake',
  'fruitland park': 'Lake', mascotte: 'Lake', 'howey-in-the-hills': 'Lake', montverde: 'Lake',
  sorrento: 'Lake', astatula: 'Lake', 'grand island': 'Lake', okahumpka: 'Lake', yalaha: 'Lake',
  paisley: 'Lake', altoona: 'Lake',
  // Sumter (1% → 7.0%)
  wildwood: 'Sumter', bushnell: 'Sumter', coleman: 'Sumter', 'center hill': 'Sumter',
  webster: 'Sumter', 'lake panasoffkee': 'Sumter', sumterville: 'Sumter', oxford: 'Sumter',
  // Marion (1.5% → 7.5%)
  ocala: 'Marion', belleview: 'Marion', summerfield: 'Marion', 'silver springs': 'Marion',
  dunnellon: 'Marion', citra: 'Marion', reddick: 'Marion', mcintosh: 'Marion', anthony: 'Marion',
  'fort mccoy': 'Marion', ocklawaha: 'Marion', weirsdale: 'Marion', sparr: 'Marion', candler: 'Marion',
  // Hernando (0.5% → 6.5%)
  brooksville: 'Hernando', 'spring hill': 'Hernando', 'weeki wachee': 'Hernando',
  nobleton: 'Hernando', istachatta: 'Hernando', 'ridge manor': 'Hernando',
  // Pasco (1% → 7.0%)
  'dade city': 'Pasco', zephyrhills: 'Pasco', 'new port richey': 'Pasco', 'port richey': 'Pasco',
  hudson: 'Pasco', 'land o lakes': 'Pasco', "land o' lakes": 'Pasco', 'wesley chapel': 'Pasco',
  holiday: 'Pasco', trinity: 'Pasco', 'san antonio': 'Pasco', 'saint leo': 'Pasco', 'st leo': 'Pasco',
  aripeka: 'Pasco', lacoochee: 'Pasco', trilby: 'Pasco',
  // Major metros
  orlando: 'Orange', apopka: 'Orange', 'winter garden': 'Orange', ocoee: 'Orange',
  kissimmee: 'Osceola', 'st cloud': 'Osceola', 'saint cloud': 'Osceola',
  tampa: 'Hillsborough', 'plant city': 'Hillsborough', brandon: 'Hillsborough', riverview: 'Hillsborough',
  'st petersburg': 'Pinellas', 'saint petersburg': 'Pinellas', clearwater: 'Pinellas', largo: 'Pinellas',
  jacksonville: 'Duval', gainesville: 'Alachua', 'daytona beach': 'Volusia', deland: 'Volusia',
  lakeland: 'Polk', 'winter haven': 'Polk', sarasota: 'Sarasota', bradenton: 'Manatee',
  'fort myers': 'Lee', 'cape coral': 'Lee', naples: 'Collier', melbourne: 'Brevard', 'palm bay': 'Brevard',
  miami: 'Miami-Dade', 'fort lauderdale': 'Broward', 'west palm beach': 'Palm Beach',
};

// ZIP (5-digit) → county. Fallback for when the city is missing or unrecognized.
export const FL_ZIP_COUNTY: Record<string, string> = {
  // Citrus
  '34423': 'Citrus', '34428': 'Citrus', '34429': 'Citrus', '34433': 'Citrus', '34434': 'Citrus',
  '34436': 'Citrus', '34442': 'Citrus', '34446': 'Citrus', '34448': 'Citrus', '34450': 'Citrus',
  '34452': 'Citrus', '34453': 'Citrus', '34461': 'Citrus', '34465': 'Citrus',
  // Lake
  '34748': 'Lake', '34749': 'Lake', '32726': 'Lake', '32727': 'Lake', '32778': 'Lake',
  '32757': 'Lake', '34711': 'Lake', '34714': 'Lake', '34715': 'Lake', '32159': 'Lake', '34731': 'Lake',
  // Sumter
  '34785': 'Sumter', '33513': 'Sumter', '33514': 'Sumter', '34484': 'Sumter', '32162': 'Sumter', '32163': 'Sumter',
  // Marion
  '34470': 'Marion', '34471': 'Marion', '34472': 'Marion', '34473': 'Marion', '34474': 'Marion',
  '34475': 'Marion', '34476': 'Marion', '34479': 'Marion', '34480': 'Marion', '34481': 'Marion',
  '34482': 'Marion', '34488': 'Marion', '34420': 'Marion', '34491': 'Marion', '34431': 'Marion', '34432': 'Marion',
  // Hernando
  '34601': 'Hernando', '34602': 'Hernando', '34604': 'Hernando', '34613': 'Hernando', '34614': 'Hernando',
  '34606': 'Hernando', '34607': 'Hernando', '34608': 'Hernando', '34609': 'Hernando', '34610': 'Hernando',
  // Pasco
  '33523': 'Pasco', '33525': 'Pasco', '33540': 'Pasco', '33541': 'Pasco', '33542': 'Pasco',
  '33543': 'Pasco', '33544': 'Pasco', '34652': 'Pasco', '34653': 'Pasco', '34654': 'Pasco',
  '34655': 'Pasco', '34667': 'Pasco', '34669': 'Pasco', '34637': 'Pasco', '34638': 'Pasco', '34639': 'Pasco',
};

// Resolves the combined Florida sales-tax rate (%) for an address, or null when the
// county can't be determined (caller keeps its default rate).
export function flTaxRate(p: { city?: string | null; zip?: string | null }): number | null {
  const city = (p.city || '').trim().toLowerCase();
  let county = city ? FL_CITY_COUNTY[city] : undefined;
  if (!county && p.zip) county = FL_ZIP_COUNTY[String(p.zip).slice(0, 5)];
  if (!county) return null;
  const surtax = FL_COUNTY_SURTAX[county];
  return surtax == null ? null : FL_STATE_RATE + surtax;
}
