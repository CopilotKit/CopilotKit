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

type PricingReadback = {
  grossRevenue: string;
  discountAmount: string;
  netRevenue: string;
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

function readPricingSummary(workbook: WorkPaper): PricingReadback {
  const cell = (address: string) => {
    const parsed = workbook.simpleCellAddressFromString(address);

    if (parsed === undefined) {
      throw new Error(`Unknown WorkPaper cell: ${address}`);
    }

    return parsed;
  };

  const displayAt = (address: string) =>
    workbook.getCellDisplayValue(cell(address));

  return {
    grossRevenue: displayAt("Summary!B2"),
    discountAmount: displayAt("Summary!B3"),
    netRevenue: displayAt("Summary!B4"),
  };
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
      const readback = readPricingSummary(workbook);
      const expectedNetRevenue =
        input.units * input.unitPrice * (1 - input.discountRate);
      const actualNetRevenue = numericDisplay(readback.netRevenue);
      const document = workbook.exportSnapshot();
      const persistedDocumentBytes = JSON.stringify(document).length;
      const restoredWorkbook = WorkPaper.buildFromSnapshot(document);

      try {
        const restoredReadback = readPricingSummary(restoredWorkbook);
        const expectedFormulaValue =
          Math.abs(actualNetRevenue - expectedNetRevenue) < 0.000001;
        const exportedSnapshot = persistedDocumentBytes > 0;
        const restartReadbackMatches =
          restoredReadback.grossRevenue === readback.grossRevenue &&
          restoredReadback.discountAmount === readback.discountAmount &&
          restoredReadback.netRevenue === readback.netRevenue;

        return NextResponse.json({
          input,
          editedCells: ["Inputs!B2", "Inputs!B3", "Inputs!B4"],
          formulaCells: ["Summary!B2", "Summary!B3", "Summary!B4"],
          readback,
          restoredReadback,
          expectedNetRevenue,
          persistedDocumentBytes,
          checks: {
            expectedFormulaValue,
            exportedSnapshot,
            restartReadbackMatches,
          },
          verified:
            expectedFormulaValue && exportedSnapshot && restartReadbackMatches,
        });
      } finally {
        restoredWorkbook.dispose();
      }
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
