// The confirmed "Solaris" template: a single smooth glowing sphere, minimal and abstract,
// coloured per real planet. Locked after the owner approved the Mars test render on 2026-09-13 —
// large dominant sphere, rich colour contrast/variance in the halo, no literal surface detail.
export function solarisPrompt(paletteDescription) {
  return 'A single smooth glowing sphere, minimal and abstract, large and dominant filling most of the ' +
    `frame, ${paletteDescription}, rich colour contrast and variance radiating around the sphere in ` +
    'distinct bands of warm and cool tones, soft even gradient light glowing from within the sphere, no ' +
    'surface texture or craters, the sphere centered alone in a deep black void, no stars, no other ' +
    'objects, clean minimal fine art composition, smooth polished digital render quality, square format';
}

export const SOLAR_PALETTES = {
  mercury: 'pale grey, warm tan, and umber tones',
  venus: 'pale cream, warm ivory, and hazy gold tones',
  earth: 'deep ocean blue, emerald green, and soft white tones',
  mars: 'deep rust red, burnt orange, and dusty ochre tones',
  jupiter: 'warm cream, tan, and burnt sienna tones',
  saturn: 'pale gold, butterscotch, and cream tones',
  uranus: 'pale icy cyan and soft turquoise tones',
  neptune: 'deep sapphire blue and violet tones',
  sun: 'molten gold, amber, and white-hot tones',
};

export const SOLAR_BODIES = Object.keys(SOLAR_PALETTES);
