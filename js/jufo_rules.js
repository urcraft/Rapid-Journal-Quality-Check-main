// Default JUFO hint rules
// These are used to correct for missing/incorrect ISSNs in Google Scholar results
// See: js/jufo.js ensureByQuery function
if(!window.scholar) window.scholar = {};
window.scholar.jufo_rules = [
  {
    "pattern": "/CHI Conference|Human Factors in Computing Systems/i",
    "issn": "2573-0142"
  },
  {
  // IEEE VR proceedings, multiple phrasings seen in Crossref/Scholar
  "pattern": "/IEEE (Conference on )?Virtual Reality( and 3D User Interfaces)?|IEEE VR(?!W)|IEEE VRW|VR 3D User Interfaces|VR '?(20)?[0-9]{2}/i",
  "issn": "2642-5246",
  // Provide an explicit canonical name for name-based fallback
  "name": "IEEE Conference on Virtual Reality and 3D User Interfaces (VR)"
  }
];
