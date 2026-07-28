// Parses the cost figures out of an Accubid "Breakdown" PDF export — the only place
// APT's material/labor/equipment/quote split and labor hours actually live. Used to
// explain WHY one bid's $/SF differs from a comparable job's.
//
// Label-based extraction against the Accubid report layout: the "Final Price" page
// lists one figure per line ("Field Labor  70,247.21  70,247.21  26.046") and the
// "Key Indicators" page carries hours, crew size and labor risk ratio.

export interface ParsedBreakdown {
  materialTotal: number | null;
  laborTotal: number | null;
  equipmentTotal: number | null;
  quotesTotal: number | null;
  primeCost: number | null;
  totalOverhead: number | null;
  totalMarkup: number | null;
  sellingPrice: number | null;
  laborHours: number | null;
  journeymanHours: number | null;
  apprenticeHours: number | null;
  avgLaborRate: number | null;
  avgCrewSize: number | null;
  laborRiskRatio: number | null;
}

const NUM = String.raw`\$?\s*([\d,]+(?:\.\d+)?)`;

// Anchored at line start so "Labor Total" doesn't also match inside "Indirect Labor Total",
// and so the Material/Labor Markup rows don't get mistaken for the totals.
function firstNumberOnLine(text: string, label: RegExp): number | null {
  const re = new RegExp(String.raw`^\s*${label.source}\s+${NUM}`, 'im');
  const m = text.match(re);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

export function parseAccubidBreakdown(text: string): ParsedBreakdown {
  // Field Labor row on the Field Labor page: "Journeyman 1.000 739.600 37.00 …"
  const journeyman = text.match(/^\s*Journeyman\s+[\d.,]+\s+([\d,]+\.?\d*)/im);
  const apprentice = text.match(/^\s*Apprentice\s+[\d.,]+\s+([\d,]+\.?\d*)/im);

  return {
    materialTotal:   firstNumberOnLine(text, /Material Total/),
    laborTotal:      firstNumberOnLine(text, /Labor Total/),
    equipmentTotal:  firstNumberOnLine(text, /Equipment/),
    quotesTotal:     firstNumberOnLine(text, /Quotes/),
    primeCost:       firstNumberOnLine(text, /Prime Cost/),
    totalOverhead:   firstNumberOnLine(text, /Total Overhead\s+[\d.]+/),
    totalMarkup:     firstNumberOnLine(text, /Total Markup\s+[\d.]+/),
    sellingPrice:    firstNumberOnLine(text, /Selling Price/),
    laborHours:      firstNumberOnLine(text, /Total Labor Hours/),
    journeymanHours: journeyman ? Number(journeyman[1].replace(/,/g, '')) : null,
    apprenticeHours: apprentice ? Number(apprentice[1].replace(/,/g, '')) : null,
    // Label is truncated to "Average Labor Cost Per Ho" in the report.
    avgLaborRate:    firstNumberOnLine(text, /Average Labor Cost Per Ho/),
    avgCrewSize:     firstNumberOnLine(text, /Avg\.? Crew Size/),
    laborRiskRatio:  firstNumberOnLine(text, /Labor Risk Ratio\s*%?/),
  };
}
