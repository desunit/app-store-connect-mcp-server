// App Store Version Localization Types
//
// A store listing is split across two resources, and ASO work needs both:
//   * appStoreVersionLocalizations — description, keywords, promotionalText,
//     whatsNew. Attached to a VERSION, so the live and next release can differ.
//   * appInfoLocalizations — name, subtitle, privacy URLs. Attached to an
//     APP INFO, because the name/subtitle are not versioned the same way.
// The keyword field must not repeat words already used in the name or subtitle
// (Apple indexes all three together), and only appInfoLocalizations exposes
// those two — see the App Info section at the bottom of this file.

export interface AppStoreVersionLocalization {
  id: string;
  type: 'appStoreVersionLocalizations';
  attributes: {
    description?: string;
    keywords?: string;
    locale: string;
    marketingUrl?: string;
    promotionalText?: string;
    supportUrl?: string;
    whatsNew?: string;
  };
  relationships?: {
    appStoreVersion?: {
      data: {
        type: 'appStoreVersions';
        id: string;
      };
    };
  };
}

export interface ListAppStoreVersionLocalizationsResponse {
  data: AppStoreVersionLocalization[];
  links?: {
    self: string;
    next?: string;
  };
  meta?: {
    paging: {
      total: number;
      limit: number;
    };
  };
}

export interface AppStoreVersionLocalizationResponse {
  data: AppStoreVersionLocalization;
  included?: any[];
  links?: {
    self: string;
  };
}

export interface AppStoreVersionLocalizationUpdateRequest {
  data: {
    type: 'appStoreVersionLocalizations';
    id: string;
    attributes: {
      description?: string;
      keywords?: string;
      marketingUrl?: string;
      promotionalText?: string;
      supportUrl?: string;
      whatsNew?: string;
    };
  };
}

export type AppStoreVersionLocalizationField = 
  | 'description'
  | 'keywords' 
  | 'marketingUrl'
  | 'promotionalText'
  | 'supportUrl'
  | 'whatsNew';

export interface AppStoreVersion {
  id: string;
  type: 'appStoreVersions';
  attributes: {
    platform: string;
    versionString?: string;
    appStoreState?: string;
    copyright?: string;
    releaseType?: string;
    earliestReleaseDate?: string;
    downloadable?: boolean;
    createdDate?: string;
  };
  relationships?: {
    app?: {
      data: {
        type: 'apps';
        id: string;
      };
    };
    appStoreVersionLocalizations?: {
      data: Array<{
        type: 'appStoreVersionLocalizations';
        id: string;
      }>;
    };
  };
}

export interface ListAppStoreVersionsResponse {
  data: AppStoreVersion[];
  links?: {
    self: string;
    next?: string;
  };
  meta?: {
    paging: {
      total: number;
      limit: number;
    };
  };
}

export interface AppStoreVersionCreateRequest {
  data: {
    type: 'appStoreVersions';
    attributes: {
      platform: 'IOS' | 'MAC_OS' | 'TV_OS' | 'VISION_OS';
      versionString: string;
      copyright?: string;
      releaseType?: 'MANUAL' | 'AFTER_APPROVAL' | 'SCHEDULED';
      earliestReleaseDate?: string; // ISO 8601 date string
    };
    relationships: {
      app: {
        data: {
          type: 'apps';
          id: string;
        };
      };
      build?: {
        data: {
          type: 'builds';
          id: string;
        };
      };
    };
  };
}

export interface AppStoreVersionResponse {
  data: AppStoreVersion;
  included?: any[];
  links?: {
    self: string;
  };
}

// App Info Localization Types (app name + subtitle)

export interface AppInfo {
  id: string;
  type: 'appInfos';
  attributes: {
    appStoreState?: string;
    state?: string;
    appStoreAgeRating?: string;
    brazilAgeRating?: string;
    brazilAgeRatingV2?: string;
    koreaAgeRating?: string;
    australiaAgeRating?: string;
    franceAgeRating?: string;
  };
  relationships?: {
    appInfoLocalizations?: {
      data?: Array<{
        type: 'appInfoLocalizations';
        id: string;
      }>;
    };
  };
}

export interface ListAppInfosResponse {
  data: AppInfo[];
  links?: {
    self: string;
    next?: string;
  };
  meta?: {
    paging?: {
      total?: number;
      limit?: number;
    };
  };
}

export interface AppInfoLocalization {
  id: string;
  type: 'appInfoLocalizations';
  attributes: {
    locale: string;
    name?: string;
    subtitle?: string;
    privacyPolicyUrl?: string;
    privacyChoicesUrl?: string;
    privacyPolicyText?: string;
  };
  relationships?: {
    appInfo?: {
      data: {
        type: 'appInfos';
        id: string;
      };
    };
  };
}

export interface ListAppInfoLocalizationsResponse {
  data: AppInfoLocalization[];
  links?: {
    self: string;
    next?: string;
  };
  meta?: {
    paging?: {
      total?: number;
      limit?: number;
    };
    /**
     * Present only when the caller passed `appId` instead of `appInfoId`, so the
     * resolved record — and whether it is the editable draft or the live one —
     * stays visible rather than being silently chosen.
     */
    appInfo?: {
      id: string;
      state?: string;
      editable: boolean;
      candidates: Array<{ id: string; state?: string }>;
    };
  };
}

export interface AppInfoLocalizationResponse {
  data: AppInfoLocalization;
  included?: any[];
  links?: {
    self: string;
  };
}

export interface AppInfoLocalizationUpdateRequest {
  data: {
    type: 'appInfoLocalizations';
    id: string;
    attributes: {
      name?: string;
      subtitle?: string;
      privacyPolicyUrl?: string;
      privacyChoicesUrl?: string;
      privacyPolicyText?: string;
    };
  };
}

export type AppInfoLocalizationField =
  | 'name'
  | 'subtitle'
  | 'privacyPolicyUrl'
  | 'privacyChoicesUrl'
  | 'privacyPolicyText';