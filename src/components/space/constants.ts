// Shared geometry + section metadata for the 3D space experience.
// Each section is placed at a fixed depth in world space; the camera
// flies along -Z through them as the user scrolls.

export type SectionMeta = {
  id: string;
  label: string;
  kicker: string;
  nav: string;
  color: string;
};

export const sections: SectionMeta[] = [
  { id: "home", label: "Launch", kicker: "00 / Entry", nav: "Home", color: "#818cf8" },
  { id: "about", label: "The Nebula", kicker: "01 / About", nav: "About", color: "#c084fc" },
  { id: "experience", label: "Asteroid Belt", kicker: "02 / Career", nav: "Experience", color: "#38bdf8" },
  { id: "skills", label: "Constellation", kicker: "03 / Skills", nav: "Skills", color: "#34d399" },
  { id: "education", label: "Orbiting Moons", kicker: "04 / Credentials", nav: "Education", color: "#fb923c" },
  { id: "contact", label: "Space Station", kicker: "05 / Contact", nav: "Contact", color: "#f472b6" },
];

export const PAGES = sections.length;

/** Distance in world units between consecutive section anchors. */
export const SECTION_SPACING = 34;

/** Total camera travel from the first to the last section. */
export const TOTAL_TRAVEL = (PAGES - 1) * SECTION_SPACING;

/** World-space Z of section i (section 0 sits at the origin). */
export function anchorZ(i: number): number {
  return -i * SECTION_SPACING;
}
