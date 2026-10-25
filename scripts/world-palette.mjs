/* Global Healthcare Directory — 25 curated color families × 10 unique shades each.
 * This is the SOURCE OF TRUTH for the map palette and its generated country catalog.
 * Rows are consumed in their written order, swatches 1 through 10 in each row.
 * No procedural interpolation, scattered colors, or contrast-based skipping.
 * The original nine shades in blue, teal, green, yellow, orange, red, pink,
 * purple, and neutral remain exactly as sampled from the owner's reference.
 * The final shade in those rows and the 16 new rows are approved expansions.
 * The U.S. is excluded from the palette and remains grey; Antarctica is excluded too and is
 * rendered ice-white (ANTARCTICA_ICE in assets/js/world-colors.js).
 *
 * FAMILY ORDER (explicit, owner-requested 2026-10-25): Purple sits 22nd, directly after Rose,
 * so ordinary countries consume it (Papua New Guinea, Australia, New Zealand, New Caledonia…).
 * Before this change Purple was 24th and only reached eight small Pacific islands. Pink and
 * Lavender each moved one slot later; families 1–21 and every hex value are unchanged. */
export const WORLD_PALETTE = Object.freeze({
  blue: ['#ECFEFF', '#74CBF5', '#65A8E5', '#5CA6F1', '#589AEF', '#3C57D4', '#4063C7', '#2B45AE', '#131C79', '#101657'],
  sky: ['#A9D6EF', '#91CDED', '#78C4ED', '#5EBBED', '#44B2EE', '#2BAAEE', '#11A1EE', '#1090D5', '#117FBB', '#126FA1'],
  cobalt: ['#A9BCEF', '#91AAED', '#7897ED', '#5E84ED', '#4471EE', '#2B5FEE', '#114CEE', '#1045D5', '#113EBB', '#1238A1'],
  indigo: ['#AFA9EF', '#9991ED', '#8278ED', '#6A5EED', '#5244EE', '#3B2BEE', '#2311EE', '#2110D5', '#1F11BB', '#1E12A1'],
  cyan: ['#A9E7EF', '#91E2ED', '#78DFED', '#5EDCED', '#44DAEE', '#2BD7EE', '#11D5EE', '#10BED5', '#11A7BB', '#1290A1'],
  aqua: ['#A9EFEB', '#91EDE9', '#78EDE7', '#5EEDE6', '#44EEE5', '#2BEEE4', '#11EEE3', '#10D5CC', '#11BBB2', '#12A19A'],
  turquoise: ['#A9EFE1', '#91EDDB', '#78EDD5', '#5EEDD1', '#44EECC', '#2BEEC7', '#11EEC2', '#10D5AE', '#11BB99', '#12A184'],
  teal: ['#F2FEFF', '#ACFAF1', '#A2F2EB', '#7FDFD1', '#66C9BD', '#376F78', '#326C77', '#265067', '#1D4250', '#12363F'],
  mint: ['#A9EFD5', '#91EDCB', '#78EDC2', '#5EEDB9', '#44EEB0', '#2BEEA6', '#11EE9D', '#10D58D', '#11BB7D', '#12A16C'],
  jade: ['#A9EFCC', '#91EDBF', '#78EDB3', '#5EEDA6', '#44EE99', '#2BEE8C', '#11EE80', '#10D573', '#11BB66', '#12A159'],
  emerald: ['#A9EFC3', '#91EDB3', '#78EDA3', '#5EED93', '#44EE82', '#2BEE72', '#11EE62', '#10D558', '#11BB4F', '#12A146'],
  green: ['#F6FEF2', '#C0FB74', '#B5F16E', '#86ED4E', '#80E148', '#62B035', '#599E31', '#3E7B22', '#2F6419', '#245312'],
  lime: ['#C3EFA9', '#B3ED91', '#A3ED78', '#93ED5E', '#82EE44', '#72EE2B', '#62EE11', '#58D510', '#4FBB11', '#46A112'],
  yellow: ['#FFFED9', '#FCEF6E', '#F4E14B', '#F2CE46', '#C59A34', '#AD932F', '#8D7125', '#7C5E1F', '#6E571B', '#54451C'],
  amber: ['#EFD6A9', '#EDCD91', '#EDC478', '#EDBB5E', '#EEB244', '#EEAA2B', '#EEA111', '#D59010', '#BB7F11', '#A16F12'],
  orange: ['#FBEA61', '#F2A43B', '#ED722F', '#F09637', '#E94E2C', '#C65323', '#A83F1A', '#852B15', '#8B2A14', '#6D2512'],
  coral: ['#EFB8A9', '#EDA591', '#ED9278', '#ED7D5E', '#EE6944', '#EE552B', '#EE4111', '#D53B10', '#BB3611', '#A13112'],
  scarlet: ['#EFAEA9', '#ED9791', '#ED8078', '#ED685E', '#EE5044', '#EE382B', '#EE1F11', '#D51D10', '#BB1D11', '#A11B12'],
  red: ['#F1A38A', '#E74A41', '#EA3A2E', '#ED7147', '#B12A19', '#E04033', '#A82517', '#881B18', '#5D101E', '#4D0B17'],
  burgundy: ['#EFA9BE', '#ED91AD', '#ED789B', '#ED5E89', '#EE4477', '#EE2B65', '#EE1153', '#D5104B', '#BB1144', '#A1123D'],
  rose: ['#EFA9CD', '#ED91C1', '#ED78B4', '#ED5EA8', '#EE449C', '#EE2B90', '#EE1183', '#D51076', '#BB1169', '#A1125C'],
  purple: ['#F9DAFA', '#DC64D4', '#DC68D1', '#AB41A6', '#8B3398', '#81298F', '#73228B', '#570D67', '#540C69', '#3E0A50'],
  pink: ['#F9D9EF', '#F19DC7', '#E46CAD', '#EA8CAE', '#B13C72', '#9A416B', '#963762', '#7D2349', '#7D195D', '#641448'],
  lavender: ['#CDA9EF', '#C191ED', '#B478ED', '#A85EED', '#9C44EE', '#902BEE', '#8311EE', '#7610D5', '#6911BB', '#5C12A1'],
  neutral: ['#DDD6DA', '#856B81', '#6B5C6E', '#4B4754', '#343A43', '#260B1A', '#150B09', '#0C0603', '#0F0601', '#202128']
});
export const WORLD_FAMILY_ORDER = Object.freeze(Object.keys(WORLD_PALETTE));
