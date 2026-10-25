/* Explicit country-by-country geographic itinerary. The U.S. is always grey and
 * excluded from country palette numbering. Do not replace this itinerary with a
 * nearest-centroid traversal or a colour-contrast optimization. Every country
 * consumes the next shade in one continuous family-by-family palette sequence. */
export const COUNTRY_COLOR_GROUPS = [
  // North and Central America
  ['CAN', 'MEX', 'GTM', 'BLZ', 'HND', 'SLV', 'NIC', 'CRI', 'PAN'],
  // South America
  ['COL', 'ECU', 'PER', 'BOL', 'CHL', 'ARG', 'FLK', 'SGS', 'URY', 'PRY', 'BRA', 'GUY', 'SUR', 'VEN'],
  // Caribbean and northern Atlantic
  ['TTO', 'GRD', 'VCT', 'LCA', 'BRB', 'DMA', 'ATG', 'KNA', 'MSR', 'BLM', 'MAF', 'SXM', 'AIA', 'VGB', 'VIR', 'PRI', 'DOM', 'HTI', 'JAM', 'CUB', 'CYM', 'BHS', 'TCA', 'BMU', 'ABW', 'CUW', 'SPM', 'GRL'],
  // Europe
  ['ISL', 'FRO', 'IRL', 'GBR', 'IMN', 'GGY', 'JEY', 'NOR', 'SWE', 'FIN', 'ALA', 'EST', 'LVA', 'LTU', 'POL', 'DNK', 'DEU', 'NLD', 'BEL', 'LUX', 'FRA', 'CHE', 'LIE', 'AUT', 'CZE', 'SVK', 'HUN', 'SVN', 'HRV', 'BIH', 'SRB', 'MNE', 'XKX', 'ALB', 'MKD', 'GRC', 'BGR', 'ROU', 'MDA', 'UKR', 'BLR', 'RUS', 'ITA', 'SMR', 'VAT', 'MCO', 'AND', 'ESP', 'PRT', 'MLT'],
  // Africa
  ['CPV', 'MAR', 'ESH', 'MRT', 'SEN', 'GMB', 'GNB', 'GIN', 'SLE', 'LBR', 'CIV', 'GHA', 'TGO', 'BEN', 'BFA', 'MLI', 'NER', 'NGA', 'CMR', 'CAF', 'TCD', 'SDN', 'SSD', 'UGA', 'KEN', 'TZA', 'RWA', 'BDI', 'COD', 'COG', 'GAB', 'GNQ', 'STP', 'AGO', 'NAM', 'ZAF', 'LSO', 'SWZ', 'BWA', 'ZWE', 'ZMB', 'MWI', 'MOZ', 'MDG', 'COM', 'MUS', 'SYC', 'SOM', 'SOL', 'DJI', 'ERI', 'ETH', 'EGY', 'LBY', 'TUN', 'DZA', 'SHN'],
  // Asia
  ['CYP', 'CYN', 'TUR', 'GEO', 'ARM', 'AZE', 'ISR', 'PSE', 'JOR', 'LBN', 'SYR', 'IRQ', 'IRN', 'KWT', 'SAU', 'BHR', 'QAT', 'ARE', 'OMN', 'YEM', 'KAZ', 'UZB', 'TKM', 'TJK', 'KGZ', 'AFG', 'PAK', 'IND', 'NPL', 'BTN', 'BGD', 'LKA', 'MDV', 'CHN', 'MNG', 'HKG', 'MAC', 'TWN', 'PRK', 'KOR', 'JPN', 'MMR', 'THA', 'LAO', 'KHM', 'VNM', 'MYS', 'SGP', 'BRN', 'IDN', 'TLS', 'PHL', 'IOT', 'IOA', 'KAS'],
  // Oceania and Pacific
  ['PNG', 'AUS', 'HMD', 'ATF', 'NFK', 'NZL', 'NCL', 'VUT', 'SLB', 'FJI', 'TON', 'WSM', 'ASM', 'WLF', 'NIU', 'COK', 'PYF', 'PCN', 'KIR', 'NRU', 'FSM', 'PLW', 'MHL', 'MNP', 'GUM'],
  // Polar
  ['ATA']
];
export const COUNTRY_COLOR_ORDER = Object.freeze(COUNTRY_COLOR_GROUPS.flat());
