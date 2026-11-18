import { provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";

import { AppComponent } from "./app/app.component";
import { appConfig, loadGenerativeUIProviders } from "./app/app.config";

loadGenerativeUIProviders()
  .then((generativeUIProviders) =>
    bootstrapApplication(AppComponent, {
      ...appConfig,
      providers: [
        provideZonelessChangeDetection(),
        ...appConfig.providers,
        ...generativeUIProviders,
      ],
    }),
  )
  .catch((error: unknown) => {
    console.error("[angular-showcase] bootstrap failed", error);
  });
