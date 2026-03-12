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

import { inject, Component } from '@angular/core';
import { CatalogService } from '../../services/catalog_service';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';

import { MatInputModule } from '@angular/material/input';
import { MatSelectChange, MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-toolbar',
  imports: [MatButtonModule, MatIconModule, MatToolbarModule, MatSelectModule, MatFormFieldModule, MatInputModule, FormsModule],
  templateUrl: './toolbar.html',
  styleUrl: './toolbar.scss',
})
export class Toolbar {
  catalogService = inject(CatalogService);
  selectedCatalogs: string[] = [];

  catalogs = [
    {
      value: 'https://raw.githubusercontent.com/google/A2UI/refs/heads/main/specification/0.8/json/standard_catalog_definition.json',
      viewValue: 'Standard'
    },
    {
      value: 'https://raw.githubusercontent.com/google/A2UI/refs/heads/main/a2a_agents/python/adk/samples/rizzcharts/rizzcharts_catalog_definition.json',
      viewValue: 'Rizzcharts Custom'
    },
  ];

  ngOnInit() {
    this.selectedCatalogs = this.catalogs.map(c => c.value);
    this.updateCatalogService();
  }

  updateCatalogService() {
    this.catalogService.catalogUris = this.selectedCatalogs;
  }

}
