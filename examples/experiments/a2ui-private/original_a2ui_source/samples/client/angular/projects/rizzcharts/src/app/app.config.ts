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

import {
  configureChatCanvasFeatures,
  usingA2aService,
  usingA2uiRenderers,
  usingMarkdownRenderer,
} from '@a2a_chat_canvas/config';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { RIZZ_CHARTS_CATALOG } from '@rizzcharts/a2ui-catalog/catalog';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { A2aService } from '../services/a2a_service';
import { RizzchartsMarkdownRendererService } from '../services/markdown-renderer.service';
import { theme } from './theme';

import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideCharts(withDefaultRegisterables()),
    configureChatCanvasFeatures(
      usingA2aService(A2aService),
      usingA2uiRenderers(RIZZ_CHARTS_CATALOG, theme),
      usingMarkdownRenderer(RizzchartsMarkdownRendererService),
    ),
  ],
};
