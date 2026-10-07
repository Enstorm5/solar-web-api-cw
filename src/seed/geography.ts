// Sri Lanka's 9 provinces and 25 administrative districts. Codes are synthetic abbreviations
// chosen for this dataset, not official SLSEA identifiers.
export interface ProvinceSeed {
  code: string;
  name: string;
  districts: Array<{ code: string; name: string }>;
}

export const PROVINCES: ProvinceSeed[] = [
  {
    code: 'WP',
    name: 'Western',
    districts: [
      { code: 'CMB', name: 'Colombo' },
      { code: 'GMP', name: 'Gampaha' },
      { code: 'KLT', name: 'Kalutara' },
    ],
  },
  {
    code: 'CP',
    name: 'Central',
    districts: [
      { code: 'KDY', name: 'Kandy' },
      { code: 'MTL', name: 'Matale' },
      { code: 'NWE', name: 'Nuwara Eliya' },
    ],
  },
  {
    code: 'SP',
    name: 'Southern',
    districts: [
      { code: 'GAL', name: 'Galle' },
      { code: 'MTR', name: 'Matara' },
      { code: 'HMB', name: 'Hambantota' },
    ],
  },
  {
    code: 'NP',
    name: 'Northern',
    districts: [
      { code: 'JAF', name: 'Jaffna' },
      { code: 'KLN', name: 'Kilinochchi' },
      { code: 'MNR', name: 'Mannar' },
      { code: 'VAV', name: 'Vavuniya' },
      { code: 'MLT', name: 'Mullaitivu' },
    ],
  },
  {
    code: 'EP',
    name: 'Eastern',
    districts: [
      { code: 'BTC', name: 'Batticaloa' },
      { code: 'AMP', name: 'Ampara' },
      { code: 'TRC', name: 'Trincomalee' },
    ],
  },
  {
    code: 'NWP',
    name: 'North Western',
    districts: [
      { code: 'KRN', name: 'Kurunegala' },
      { code: 'PTM', name: 'Puttalam' },
    ],
  },
  {
    code: 'NCP',
    name: 'North Central',
    districts: [
      { code: 'ANP', name: 'Anuradhapura' },
      { code: 'POL', name: 'Polonnaruwa' },
    ],
  },
  {
    code: 'UVA',
    name: 'Uva',
    districts: [
      { code: 'BDL', name: 'Badulla' },
      { code: 'MON', name: 'Monaragala' },
    ],
  },
  {
    code: 'SGP',
    name: 'Sabaragamuwa',
    districts: [
      { code: 'RAT', name: 'Ratnapura' },
      { code: 'KEG', name: 'Kegalle' },
    ],
  },
];

/** Districts that receive a second grid substation (25 + 5 = 30 substations). */
export const EXTRA_SUBSTATION_DISTRICTS = ['CMB', 'GMP', 'KDY', 'KRN', 'GAL'];
