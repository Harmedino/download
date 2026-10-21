import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { clientIdInterceptor } from './core/client-id';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // XHR backend (not withFetch) so multipart uploads can report progress.
    provideHttpClient(withInterceptors([clientIdInterceptor])),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
      // Cross-fades pages on navigation; browsers without the API just swap instantly.
      withViewTransitions({ skipInitialTransition: true }),
    ),
  ],
};
