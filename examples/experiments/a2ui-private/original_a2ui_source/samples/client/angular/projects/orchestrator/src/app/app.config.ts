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
  usingDefaultSanitizerMarkdownRenderer,
} from '@a2a_chat_canvas/config';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { DEMO_CATALOG } from '../a2ui-catalog/catalog';
import { A2aServiceImpl } from '../services/a2a-service-impl';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideCharts(withDefaultRegisterables()),
    configureChatCanvasFeatures(
      usingA2aService(A2aServiceImpl),
      usingA2uiRenderers(DEMO_CATALOG),
      usingDefaultSanitizerMarkdownRenderer(),
    ),
  ],
};
