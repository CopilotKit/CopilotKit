import { NextRequest, NextResponse } from "next/server";
import { WorkPaper } from "@bilig/workpaper";

type PricingInput = {
  units?: unknown;
  unitPrice?: unknown;
  discountRate?: unknown;
};

type ParsedPricingInput = {
  units: number;
  unitPrice: number;
  discountRate: number;
};

function parseNumber(value: unknown, name: string) {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number`);
  }

  return parsed;
}

function parsePricingInput(input: PricingInput): ParsedPricingInput {
  return {
    units: parseNumber(input.units, "units"),
    unitPrice: parseNumber(input.unitPrice, "unitPrice"),
    discountRate: parseNumber(input.discountRate, "discountRate"),
  };
}

function numericDisplay(value: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric WorkPaper display value, got ${value}`);
  }

  return parsed;
}

export async function POST(request: NextRequest) {
  try {
    const input = parsePricingInput(await request.json());
    const workbook = WorkPaper.buildFromSheets({
      Inputs: [
        ["Metric", "Value"],
        ["Units", input.units],
        ["Unit Price", input.unitPrice],
        ["Discount Rate", input.discountRate],
      ],
      Summary: [
        ["Metric", "Value"],
        ["Gross Revenue", "=Inputs!B2*Inputs!B3"],
        ["Discount Amount", "=Summary!B2*Inputs!B4"],
        ["Net Revenue", "=Summary!B2-Summary!B3"],
      ],
    });

    try {
      const cell = (address: string) => {
        const parsed = workbook.simpleCellAddressFromString(address);

        if (parsed === undefined) {
          throw new Error(`Unknown WorkPaper cell: ${address}`);
        }

        return parsed;
      };

      const displayAt = (address: string) =>
        workbook.getCellDisplayValue(cell(address));

      const grossRevenue = displayAt("Summary!B2");
      const discountAmount = displayAt("Summary!B3");
      const netRevenue = displayAt("Summary!B4");
      const expectedNetRevenue =
        input.units * input.unitPrice * (1 - input.discountRate);
      const actualNetRevenue = numericDisplay(netRevenue);
      const document = workbook.exportSnapshot();

      return NextResponse.json({
        input,
        editedCells: ["Inputs!B2", "Inputs!B3", "Inputs!B4"],
        formulaCells: ["Summary!B2", "Summary!B3", "Summary!B4"],
        readback: {
          grossRevenue,
          discountAmount,
          netRevenue,
        },
        expectedNetRevenue,
        persistedDocumentBytes: JSON.stringify(document).length,
        verified: Math.abs(actualNetRevenue - expectedNetRevenue) < 0.000001,
      });
    } finally {
      workbook.dispose();
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 },
    );
  }
}
