import { AppStoreConnectClient } from '../services/index.js';
import {
  ListAppStoreVersionLocalizationsResponse,
  AppStoreVersionLocalizationResponse,
  AppStoreVersionLocalizationUpdateRequest,
  AppStoreVersionLocalizationField,
  ListAppStoreVersionsResponse,
  AppStoreVersionCreateRequest,
  AppStoreVersionResponse,
  ListAppInfosResponse,
  ListAppInfoLocalizationsResponse,
  AppInfoLocalizationResponse,
  AppInfoLocalizationUpdateRequest,
  AppInfoLocalizationField
} from '../types/index.js';
import { validateRequired, sanitizeLimit } from '../utils/index.js';

/**
 * appInfo states that are already published or superseded. Neither can be
 * PATCHed, so when resolving an appId we prefer anything else.
 */
const NON_EDITABLE_APP_INFO_STATES = new Set([
  'READY_FOR_DISTRIBUTION',
  'REPLACED_WITH_NEW_INFO',
  'REMOVED_FROM_SALE'
]);

/** Apple rejects a longer name or subtitle with a 409 at PATCH time. */
const APP_INFO_FIELD_MAX_LENGTH: Partial<Record<AppInfoLocalizationField, number>> = {
  name: 30,
  subtitle: 30
};

export class LocalizationHandlers {
  constructor(private client: AppStoreConnectClient) {}

  async listAppStoreVersions(args: {
    appId: string;
    limit?: number;
    filter?: {
      platform?: string;
      versionString?: string;
      appStoreState?: string;
    };
  }): Promise<ListAppStoreVersionsResponse> {
    const { appId, limit = 100, filter } = args;
    
    validateRequired(args, ['appId']);
    
    const params: Record<string, any> = {
      limit: sanitizeLimit(limit)
    };

    if (filter?.platform) {
      params['filter[platform]'] = filter.platform;
    }
    
    if (filter?.versionString) {
      params['filter[versionString]'] = filter.versionString;
    }
    
    if (filter?.appStoreState) {
      params['filter[appStoreState]'] = filter.appStoreState;
    }
    
    // Versions are only listable through the app relationship — there is no
    // GET /v1/appStoreVersions collection root (only /v1/appStoreVersions/{id}),
    // so a filter[app] query against the root returns 404 NOT_FOUND.
    return this.client.get<ListAppStoreVersionsResponse>(
      `/apps/${appId}/appStoreVersions`,
      params
    );
  }

  async listAppStoreVersionLocalizations(args: {
    appStoreVersionId: string;
    limit?: number;
  }): Promise<ListAppStoreVersionLocalizationsResponse> {
    const { appStoreVersionId, limit = 100 } = args;
    
    validateRequired(args, ['appStoreVersionId']);
    
    const params: Record<string, any> = {
      limit: sanitizeLimit(limit)
    };

    // Same as above: localizations are reachable only via the version
    // relationship. GET /v1/appStoreVersionLocalizations (collection) does not
    // exist — only the single-resource /{id} form does.
    return this.client.get<ListAppStoreVersionLocalizationsResponse>(
      `/appStoreVersions/${appStoreVersionId}/appStoreVersionLocalizations`,
      params
    );
  }

  async getAppStoreVersionLocalization(args: {
    localizationId: string;
  }): Promise<AppStoreVersionLocalizationResponse> {
    const { localizationId } = args;
    
    validateRequired(args, ['localizationId']);
    
    return this.client.get<AppStoreVersionLocalizationResponse>(
      `/appStoreVersionLocalizations/${localizationId}`
    );
  }

  async updateAppStoreVersionLocalization(args: {
    localizationId: string;
    field: AppStoreVersionLocalizationField;
    value: string;
  }): Promise<AppStoreVersionLocalizationResponse> {
    const { localizationId, field, value } = args;
    
    validateRequired(args, ['localizationId', 'field', 'value']);
    
    // Validate field
    const validFields: AppStoreVersionLocalizationField[] = [
      'description', 'keywords', 'marketingUrl', 
      'promotionalText', 'supportUrl', 'whatsNew'
    ];
    
    if (!validFields.includes(field)) {
      throw new Error(`Invalid field: ${field}. Must be one of: ${validFields.join(', ')}`);
    }
    
    const requestData: AppStoreVersionLocalizationUpdateRequest = {
      data: {
        type: 'appStoreVersionLocalizations',
        id: localizationId,
        attributes: {
          [field]: value
        }
      }
    };
    
    return this.client.patch<AppStoreVersionLocalizationResponse>(
      `/appStoreVersionLocalizations/${localizationId}`,
      requestData
    );
  }

  async createAppStoreVersion(args: {
    appId: string;
    platform: 'IOS' | 'MAC_OS' | 'TV_OS' | 'VISION_OS';
    versionString: string;
    copyright?: string;
    releaseType?: 'MANUAL' | 'AFTER_APPROVAL' | 'SCHEDULED';
    earliestReleaseDate?: string;
    buildId?: string;
  }): Promise<AppStoreVersionResponse> {
    const { 
      appId, 
      platform, 
      versionString, 
      copyright, 
      releaseType, 
      earliestReleaseDate,
      buildId 
    } = args;
    
    validateRequired(args, ['appId', 'platform', 'versionString']);
    
    // Validate version string format
    const versionRegex = /^\d+\.\d+(\.\d+)?$/;
    if (!versionRegex.test(versionString)) {
      throw new Error('Version string must be in format X.Y or X.Y.Z (e.g., 1.0 or 1.0.0)');
    }
    
    // Validate release date if provided
    if (earliestReleaseDate) {
      const date = new Date(earliestReleaseDate);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid release date format. Use ISO 8601 format (e.g., 2024-01-01T00:00:00Z)');
      }
      if (releaseType !== 'SCHEDULED') {
        throw new Error('earliestReleaseDate can only be set when releaseType is SCHEDULED');
      }
    }
    
    const requestData: AppStoreVersionCreateRequest = {
      data: {
        type: 'appStoreVersions',
        attributes: {
          platform,
          versionString,
          ...(copyright && { copyright }),
          ...(releaseType && { releaseType }),
          ...(earliestReleaseDate && { earliestReleaseDate })
        },
        relationships: {
          app: {
            data: {
              type: 'apps',
              id: appId
            }
          },
          ...(buildId && {
            build: {
              data: {
                type: 'builds',
                id: buildId
              }
            }
          })
        }
      }
    };
    
    return this.client.post<AppStoreVersionResponse>(
      '/appStoreVersions',
      requestData
    );
  }

  // ---------------------------------------------------------------------
  // App Info localizations — the app name and subtitle.
  //
  // These do NOT live on appStoreVersionLocalizations (that resource carries
  // description/keywords/whatsNew only). Apple indexes name + subtitle +
  // keywords together for search, so any keyword-field work needs to read the
  // name and subtitle first to avoid spending characters on repeated words.
  // ---------------------------------------------------------------------

  async listAppInfos(args: {
    appId: string;
    limit?: number;
  }): Promise<ListAppInfosResponse> {
    const { appId, limit = 100 } = args;

    validateRequired(args, ['appId']);

    // As with versions and their localizations, appInfos are reachable only
    // through the app relationship — there is no GET /v1/appInfos collection
    // root, so a filter[app] query against it returns 404 NOT_FOUND.
    return this.client.get<ListAppInfosResponse>(
      `/apps/${appId}/appInfos`,
      { limit: sanitizeLimit(limit) }
    );
  }

  /**
   * Resolve an appId to the appInfo the caller most likely wants to read and
   * edit: the editable draft when one exists, otherwise the only record.
   */
  private async resolveAppInfo(appId: string): Promise<{
    id: string;
    state?: string;
    editable: boolean;
    candidates: Array<{ id: string; state?: string }>;
  }> {
    const { data } = await this.listAppInfos({ appId });

    if (!data?.length) {
      throw new Error(
        `No appInfo found for app ${appId}. Check the app ID and that the API key has access to it.`
      );
    }

    const candidates = data.map(info => ({
      id: info.id,
      state: info.attributes?.state ?? info.attributes?.appStoreState
    }));

    const editable = candidates.find(
      c => !c.state || !NON_EDITABLE_APP_INFO_STATES.has(c.state)
    );
    const chosen = editable ?? candidates[0];

    return {
      id: chosen.id,
      state: chosen.state,
      editable: Boolean(editable),
      candidates
    };
  }

  async listAppInfoLocalizations(args: {
    appInfoId?: string;
    appId?: string;
    locale?: string;
    limit?: number;
  }): Promise<ListAppInfoLocalizationsResponse> {
    const { appInfoId, appId, locale, limit = 100 } = args;

    if (!appInfoId && !appId) {
      throw new Error('Provide either appInfoId or appId.');
    }

    const resolved = appInfoId ? undefined : await this.resolveAppInfo(appId!);
    const targetId = appInfoId ?? resolved!.id;

    const params: Record<string, any> = { limit: sanitizeLimit(limit) };
    if (locale) {
      params['filter[locale]'] = locale;
    }

    const response = await this.client.get<ListAppInfoLocalizationsResponse>(
      `/appInfos/${targetId}/appInfoLocalizations`,
      params
    );

    // Surface which appInfo was picked, so a caller that passed appId can tell
    // whether it is looking at the editable draft or the live record.
    if (resolved) {
      response.meta = { ...(response.meta ?? {}), appInfo: resolved };
    }

    return response;
  }

  async getAppInfoLocalization(args: {
    localizationId: string;
  }): Promise<AppInfoLocalizationResponse> {
    const { localizationId } = args;

    validateRequired(args, ['localizationId']);

    return this.client.get<AppInfoLocalizationResponse>(
      `/appInfoLocalizations/${localizationId}`
    );
  }

  async updateAppInfoLocalization(args: {
    localizationId: string;
    field: AppInfoLocalizationField;
    value: string;
  }): Promise<AppInfoLocalizationResponse> {
    const { localizationId, field, value } = args;

    validateRequired(args, ['localizationId', 'field', 'value']);

    const validFields: AppInfoLocalizationField[] = [
      'name', 'subtitle', 'privacyPolicyUrl', 'privacyChoicesUrl', 'privacyPolicyText'
    ];

    if (!validFields.includes(field)) {
      throw new Error(`Invalid field: ${field}. Must be one of: ${validFields.join(', ')}`);
    }

    // Check the length here rather than letting Apple return a 409 — the error
    // it sends back does not name the offending field.
    const maxLength = APP_INFO_FIELD_MAX_LENGTH[field];
    if (maxLength && value.length > maxLength) {
      throw new Error(
        `${field} is ${value.length} characters. The App Store limit is ${maxLength}.`
      );
    }

    const requestData: AppInfoLocalizationUpdateRequest = {
      data: {
        type: 'appInfoLocalizations',
        id: localizationId,
        attributes: {
          [field]: value
        }
      }
    };

    return this.client.patch<AppInfoLocalizationResponse>(
      `/appInfoLocalizations/${localizationId}`,
      requestData
    );
  }
}