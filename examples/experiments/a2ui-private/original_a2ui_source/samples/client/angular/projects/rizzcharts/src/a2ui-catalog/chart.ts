/*
 Copyright 2025 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import { DynamicComponent } from '@a2ui/angular';
import * as v0_8 from '@a2ui/web-lib/0.8';
import { Component, computed, input, Signal, signal, ViewChild } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { ChartData, ChartEvent, ChartOptions, ChartType, LegendItem } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';

@Component({
  selector: 'a2ui-chart',
  imports: [BaseChartDirective, MatIconButton, MatIcon],
  styles: `
    :host {
      display: block;
      flex: var(--weight);
      padding: 20px;
    }

    .chart-box-container {
      background-color: var(--mat-sys-surface-container); /* Dark background for the box */
      border-radius: 8px;
      border: 1px solid #444; /* Subtle border for dark theme */
      padding: 20px;
      margin: 20px auto; /* Center the box */
      max-width: 800px; /* Limit width for better appearance */
    }

    /* Combined header for title and icon */
    .chart-header {
      display: flex;
      justify-content: space-between; /* Pushes title to left, icon to right */
      align-items: start; /* Vertically centers title and icon */
      margin-bottom: 15px; /* Space below the header */
    }

    .chart-header h2 {
      margin: 0; /* Remove default margin from h2 */
      font-size: 24px;
      color: var(--mat-sys-on-surface-container); /* Light text for title */
    }

    .header-icon {
      cursor: pointer;
      line-height: 0; /* Helps with vertical alignment of SVG */
    }

    .chart-container {
      width: 100%;
      display: flex;
      flex-direction: column;
      font-family: Arial, sans-serif;
      color: #ccc; /* Light text for dark theme */
    }

    .chart-container p {
      margin-bottom: 10px;
      color: #ccc; /* Light text for dark theme */
    }
  `,
  template: `
    <div class="chart-box-container">
      <!-- Combined header for title and icon -->
      <div class="chart-header">
        <div>
          <h2>{{ resolvedTitle() }}</h2>
          @if (isDrillDown()) {
            <h3>{{ selectedCategory() }}</h3>
          }
        </div>

        <div>
          <button matIconButton>
            <mat-icon>download</mat-icon>
          </button>
          <button matIconButton>
            <mat-icon>share</mat-icon>
          </button>
        </div>
      </div>
      <div class="chart-container">
        @if (isDrillDown()) {
          <button matIconButton (click)="restoreOriginalView()">
            <mat-icon>arrow_back</mat-icon>
          </button>
        }

        <canvas
          baseChart
          [data]="currentData()"
          [type]="chartType()"
          [options]="chartOptions"
          (chartClick)="onClick($event)"
        ></canvas>
      </div>
    </div>
  `,
})
export class Chart extends DynamicComponent<v0_8.Types.CustomNode> {
  readonly type = input.required<string>();
  protected readonly chartType = computed(() => this.type() as ChartType);

  readonly title = input<v0_8.Primitives.StringValue | null>();
  protected readonly resolvedTitle: Signal<string | null> = computed(() =>
    super.resolvePrimitive(this.title() ?? null),
  );

  readonly chartData = input.required<v0_8.Primitives.StringValue | null>();
  protected readonly resolvedPieChartData: Signal<
    Map<string, ChartData<'pie', number[], string>> | undefined
  > = computed(() => {
    const chartDataPathPrefix = this.chartData();
    const chartType = this.chartType();
    if (chartDataPathPrefix === null) {
      return undefined;
    }
    if (chartType === 'pie' || chartType === 'doughnut') {
      return this.resolvePieChartData(chartDataPathPrefix);
    }
    console.error('Unsupported chart type specified:', chartType);
    return undefined;
  });

  protected readonly selectedCategory = signal('root');
  protected readonly isDrillDown = computed(() => this.selectedCategory() !== 'root');
  protected readonly currentData: Signal<ChartData<'pie', number[], string> | undefined> = computed(
    () => {
      const selectedCategory: string = this.selectedCategory();
      const allData = this.resolvedPieChartData();
      if (!allData) {
        return undefined;
      }
      return { ...allData.get(selectedCategory) } as ChartData<'pie', number[], string>;
    },
  );

  @ViewChild(BaseChartDirective) chart?: BaseChartDirective;
  protected chartOptions: ChartOptions = {
    responsive: true,
    plugins: {
      legend: {
        display: true,
        position: 'right',
        labels: {
          color: '#166a8f',
          font: {
            size: 14,
          },
        },
        onClick: (e: ChartEvent, legendItem: LegendItem) => {
          this.updateChartWithCategory(legendItem.text);
        },
      },
      datalabels: {
        formatter: (value: number, ctx: any) => {
          const total = (ctx.chart.data.datasets[0].data as number[]).reduce((a, b) => a + b, 0);
          const percentage = Math.round((value / total) * 100);
          return `${percentage.toFixed(1)}%`;
        },
        color: 'white',
        font: {
          size: 16,
        },
      },
    },
  };

  private resolvePieChartData(
    pathPrefix: v0_8.Primitives.StringValue,
  ): Map<string, ChartData<'pie', number[], string>> | undefined {
    const dataMap = new Map<string, ChartData<'pie', number[], string>>();
    const labels: string[] = [];
    const data: number[] = [];
    if (pathPrefix?.path) {
      for (let index: number = 0; index < 500; index++) {
        const itemPrefix = `${pathPrefix.path}[${index}]`;
        const labelPath: v0_8.Primitives.StringValue = { path: `${itemPrefix}.label` };
        const valuePath: v0_8.Primitives.NumberValue = { path: `${itemPrefix}.value` };
        const label = super.resolvePrimitive(labelPath);
        const value = super.resolvePrimitive(valuePath);
        if (label === null || value === null) {
          break;
        }
        labels.push(label);
        data.push(value);

        const drilldownLabels: string[] = [];
        const drilldownData: number[] = [];
        const drilldownPathPrefix = `${itemPrefix}.drillDown`;
        for (let jindex: number = 0; jindex < 500; jindex++) {
          const drilldownItemPrefix = `${drilldownPathPrefix}[${jindex}]`;
          const drilldownLabelPath: v0_8.Primitives.StringValue = {
            path: `${drilldownItemPrefix}.label`,
          };
          const drilldownValuePath: v0_8.Primitives.NumberValue = {
            path: `${drilldownItemPrefix}.value`,
          };
          const drilldownLabel = super.resolvePrimitive(drilldownLabelPath);
          const drilldownValue = super.resolvePrimitive(drilldownValuePath);
          if (drilldownLabel === null || drilldownValue === null) {
            break;
          }
          drilldownLabels.push(drilldownLabel);
          drilldownData.push(drilldownValue);
        }

        const drilldownChartData: ChartData<'pie', number[], string> = {
          labels: drilldownLabels,
          datasets: [
            {
              data: drilldownData,
            },
          ],
        };
        dataMap.set(label, drilldownChartData);
      }
    }

    const rootData: ChartData<'pie', number[], string> = {
      labels,
      datasets: [
        {
          data,
        },
      ],
    };
    dataMap.set('root', rootData);
    return dataMap;
  }

  public restoreOriginalView() {
    this.selectedCategory.set('root');
  }

  protected onClick(e: { event?: ChartEvent; active?: any[] | undefined }) {
    const active = e.active;
    if (!active || active.length === 0) return;

    // active[0] for pie chart contains the data index that was clicked
    // @ts-ignore -- ActiveElement typing can vary between versions
    const dataIndex: number | undefined = (active[0] as any).index;
    const labels = [...(this.currentData()?.labels ?? [])];
    const label = labels && typeof dataIndex === 'number' ? labels[dataIndex] : undefined;
    if (label) {
      this.updateChartWithCategory(label);
    }
  }

  private updateChartWithCategory(label: string) {
    const currentCategory = this.selectedCategory();
    if (currentCategory !== 'root') {
      console.error('Cannot drilldown further');
      return;
    }
    this.selectedCategory.set(label);
  }
}
