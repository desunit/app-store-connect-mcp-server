// NOTE: these are the values Apple's `filter[category]` accepts on
// /analyticsReportRequests/{id}/reports. `COMMERCE` and `FRAMEWORK_USAGE`
// are singular — `APP_STORE_COMMERCE` / `FRAMEWORKS_USAGE` return 400.
export type AnalyticsReportCategory =
  | 'APP_STORE_ENGAGEMENT'
  | 'COMMERCE'
  | 'APP_USAGE'
  | 'FRAMEWORK_USAGE'
  | 'PERFORMANCE';

export type AnalyticsReportGranularity = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export type AnalyticsAccessType = 'ONGOING' | 'ONE_TIME_SNAPSHOT';

export interface AnalyticsReportRequest {
  data: {
    type: 'analyticsReportRequests';
    attributes: {
      accessType: AnalyticsAccessType;
    };
    relationships: {
      app: {
        data: {
          id: string;
          type: 'apps';
        };
      };
    };
  };
}

export interface AnalyticsReportRequestResponse {
  data: {
    id: string;
    type: 'analyticsReportRequests';
    attributes: {
      accessType: AnalyticsAccessType;
      stoppedDueToInactivity: boolean;
    };
    relationships: {
      app: {
        data: {
          id: string;
          type: 'apps';
        };
      };
      reports: {
        data: Array<{
          id: string;
          type: 'analyticsReports';
        }>;
      };
    };
  };
}

export interface AnalyticsReport {
  id: string;
  type: 'analyticsReports';
  attributes: {
    category: AnalyticsReportCategory;
    name: string;
    instancesCount: number;
  };
}

export interface AnalyticsReportInstance {
  id: string;
  type: 'analyticsReportInstances';
  attributes: {
    granularity: AnalyticsReportGranularity;
    processingDate: string;
  };
}

export interface AnalyticsReportSegment {
  id: string;
  type: 'analyticsReportSegments';
  attributes: {
    checksum: string;
    sizeInBytes: number;
    url: string;
  };
}

export interface AnalyticsReportRequestSummary {
  id: string;
  type: 'analyticsReportRequests';
  attributes: {
    accessType: AnalyticsAccessType;
    stoppedDueToInactivity: boolean;
  };
}

export interface ListAnalyticsReportRequestsResponse {
  data: AnalyticsReportRequestSummary[];
}

export interface ListAnalyticsReportsResponse {
  data: AnalyticsReport[];
}

export interface ListAnalyticsReportInstancesResponse {
  data: AnalyticsReportInstance[];
}

export interface ListAnalyticsReportSegmentsResponse {
  data: AnalyticsReportSegment[];
}

// Sales and Finance Reports Types
export type SalesReportType =
  | 'SALES'
  | 'SUBSCRIPTION'        // Active subscriber state (snapshot of active subs as of reportDate)
  | 'SUBSCRIPTION_EVENT'  // Subscription lifecycle events incl. cancellations / churn
  | 'SUBSCRIBER'          // Detailed per-subscriber transactions
  | 'NEWSSTAND'
  | 'PRE_ORDER';
export type SalesReportSubType = 'SUMMARY' | 'DETAILED' | 'OPT_IN';
export type SalesReportFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface SalesReportResponse {
  data: string; // CSV data
}

export interface FinanceReportResponse {
  data: string; // CSV data
}

export interface SalesReportFilters {
  reportDate: string;
  reportType: SalesReportType;
  reportSubType: SalesReportSubType;
  frequency: SalesReportFrequency;
  vendorNumber: string;
  version?: string; // Report version, e.g. '1_4' for SUBSCRIPTION/SUBSCRIPTION_EVENT, '1_1' for SALES
}

export interface FinanceReportFilters {
  reportDate: string;
  regionCode: string;
  vendorNumber: string;
}