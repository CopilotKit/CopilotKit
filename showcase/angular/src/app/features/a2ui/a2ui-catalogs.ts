import type { A2UIConfig } from "@copilotkit/angular";
import { createAngularCatalog } from "@copilotkit/angular/a2ui";
import {
  beautifulDefinitions,
  declarativeDefinitions,
  fixedDefinitions,
} from "./a2ui-definitions";

import {
  BeautifulBadgeComponent,
  BeautifulBarChartComponent,
  BeautifulButtonComponent,
  BeautifulColumnComponent,
  BeautifulDashboardCardComponent,
  BeautifulDataTableComponent,
  BeautifulFlightCardComponent,
  BeautifulMetricComponent,
  BeautifulPieChartComponent,
  BeautifulRowComponent,
  BeautifulTitleComponent,
} from "./beautiful-components";
import {
  DeclarativeBarChartComponent,
  DeclarativeCardComponent,
  DeclarativeColumnComponent,
  DeclarativeDataTableComponent,
  DeclarativeInfoRowComponent,
  DeclarativeMetricComponent,
  DeclarativePieChartComponent,
  DeclarativePrimaryButtonComponent,
  DeclarativeRowComponent,
  DeclarativeStatusBadgeComponent,
  DeclarativeTextComponent,
} from "./declarative-components";
import {
  FixedAirlineBadgeComponent,
  FixedAirportComponent,
  FixedArrowComponent,
  FixedButtonComponent,
  FixedCardComponent,
  FixedPriceTagComponent,
  FixedTitleComponent,
} from "./fixed-components";

const declarativeCatalog = createAngularCatalog(
  declarativeDefinitions,
  {
    Row: DeclarativeRowComponent,
    Column: DeclarativeColumnComponent,
    Text: DeclarativeTextComponent,
    Card: DeclarativeCardComponent,
    StatusBadge: DeclarativeStatusBadgeComponent,
    Metric: DeclarativeMetricComponent,
    InfoRow: DeclarativeInfoRowComponent,
    DataTable: DeclarativeDataTableComponent,
    PrimaryButton: DeclarativePrimaryButtonComponent,
    PieChart: DeclarativePieChartComponent,
    BarChart: DeclarativeBarChartComponent,
  },
  { catalogId: "declarative-gen-ui-catalog", includeBasicCatalog: true },
);

const fixedCatalog = createAngularCatalog(
  fixedDefinitions,
  {
    Card: FixedCardComponent,
    Title: FixedTitleComponent,
    Airport: FixedAirportComponent,
    Arrow: FixedArrowComponent,
    AirlineBadge: FixedAirlineBadgeComponent,
    PriceTag: FixedPriceTagComponent,
    Button: FixedButtonComponent,
  },
  {
    catalogId: "copilotkit://flight-fixed-catalog",
    includeBasicCatalog: true,
  },
);

const beautifulCatalog = createAngularCatalog(
  beautifulDefinitions,
  {
    Title: BeautifulTitleComponent,
    Row: BeautifulRowComponent,
    Column: BeautifulColumnComponent,
    DashboardCard: BeautifulDashboardCardComponent,
    Metric: BeautifulMetricComponent,
    PieChart: BeautifulPieChartComponent,
    BarChart: BeautifulBarChartComponent,
    Badge: BeautifulBadgeComponent,
    DataTable: BeautifulDataTableComponent,
    Button: BeautifulButtonComponent,
    FlightCard: BeautifulFlightCardComponent,
  },
  {
    catalogId: "copilotkit://app-dashboard-catalog",
    includeBasicCatalog: true,
  },
);

/** Select the exact A2UI catalog and recovery behavior for a demo route. */
// @region[a2ui-schema-and-recovery]
export function a2uiConfigForFeature(feature: string): A2UIConfig | undefined {
  switch (feature) {
    case "beautiful-chat":
      return { catalog: beautifulCatalog };
    case "declarative-gen-ui":
      return { catalog: declarativeCatalog };
    case "a2ui-recovery":
      return {
        catalog: declarativeCatalog,
        recovery: { showAfterMs: 2_000, showAfterAttempts: 2 },
      };
    case "a2ui-fixed-schema":
      return { catalog: fixedCatalog };
    default:
      return undefined;
  }
}
// @endregion[a2ui-schema-and-recovery]
