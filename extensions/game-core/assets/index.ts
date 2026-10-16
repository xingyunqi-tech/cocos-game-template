export const GAME_CORE_VERSION = '0.5.0';

export { GameRoot, CONFIG_LOAD_ATTEMPTS, CONFIG_PATH } from './boot/GameRoot';
export { BootPipeline, BootStepError } from './boot/BootPipeline';
export type { StepContext, StepOptions, StepResult, StepRun } from './boot/BootPipeline';
export { Lifecycle } from './boot/Lifecycle';
export { retry } from './boot/retry';
export { getEnv } from './config/env';
export { RemoteConfig } from './config/RemoteConfig';
export {
    ads,
    appUpdate,
    auth,
    bootPipeline,
    checkStorageUsage,
    confirm,
    createPrivacyPrompt,
    coreOptions,
    coreUi,
    defaultPrivacyPrompt,
    getDesignInset,
    healthNotice,
    onSidebarLaunch,
    privacy,
    settings,
    setGameEntry,
    sidebarReward,
    deviceSave,
    getDeviceId,
    http,
    initGameCore,
    lifecycle,
    LOGIN_STEP_TIMEOUT_MS,
    mockTransport,
    network,
    platform,
    remoteConfig,
    setSaveUser,
    sidebar,
    STORAGE_WARN_RATIO,
    userSave,
} from './core';
export type { ConfirmProvider, CoreRemoteSettings, GameEntry, PrivacyPromptText } from './core';
export { createLogger, logHub } from './monitor/logger';
export type { LogLevel, LogRecord, LogSink, Logger } from './monitor/logger';
export { track, tracker } from './monitor/track';
export type { TrackEvent, TrackParams, TrackSink } from './monitor/track';
export { errorReporter, reportError } from './monitor/errors';
export type { ErrorReport, ErrorSink, ErrorSource } from './monitor/errors';
export { HttpClient } from './net/HttpClient';
export type {
    BusinessResult,
    HttpClientOptions,
    RequestInterceptor,
    ResponseInterceptor,
    TokenProvider,
} from './net/HttpClient';
export { MockTransport } from './net/MockTransport';
export type { MockHandler, MockReply, MockRequest } from './net/MockTransport';
export { CancelSource, HttpError } from './net/types';
export { XhrTransport } from './net/XhrTransport';
export type {
    CancelSignal,
    HttpErrorKind,
    HttpMethod,
    HttpRequest,
    HttpResponse,
    HttpTransport,
    TransportRequest,
    TransportResponse,
} from './net/types';
export { SaveSlot, SaveStore } from './save/SaveStore';
export type { Migration, SaveStoreOptions, SlotOptions } from './save/SaveStore';
export { MemoryStore } from './save/KeyValueStore';
export type { KeyValueStore } from './save/KeyValueStore';
export { AdPolicy, DEFAULT_AD_POLICY } from './ads/AdPolicy';
export type { AdPolicyOptions } from './ads/AdPolicy';
export { AdService } from './ads/AdService';
export type { AdServiceOptions, AdUnits } from './ads/AdService';
export { AuthService } from './net/AuthService';
export type {
    AuthServiceOptions,
    AuthSession,
    LoginFallback,
    LoginOutcome,
    LoginResponse,
    RefreshResponse,
} from './net/AuthService';
export { AppUpdate } from './platform/AppUpdate';
export { NetworkStatus } from './platform/NetworkStatus';
export type { NetworkListener } from './platform/NetworkStatus';
export { compareVersion, isSidebarLaunch, SIDEBAR_SCENES } from './platform/utils';
export type {
    AdFailReason,
    AdProvider,
    EnvVersion,
    InterstitialResult,
    IPlatform,
    ISidebar,
    LaunchOptions,
    LoginCredential,
    NetworkType,
    PlatformName,
    PrivacyHandler,
    PrivacySetting,
    Rect,
    RewardedResult,
    ShareOptions,
    ShareResult,
    StorageUsage,
    SystemInfo,
    TopInset,
} from './platform/types';
export { HEALTH_NOTICE, platformManagedAntiAddiction } from './compliance/health';
export type { AntiAddictionStatus, IAntiAddiction } from './compliance/health';
export { HealthNotice } from './compliance/HealthNotice';
export { PrivacyFlow } from './compliance/PrivacyFlow';
export type { PrivacyPrompt } from './compliance/PrivacyFlow';
export { SidebarReward } from './compliance/SidebarReward';
export type { ConfirmOptions } from './ui/ConfirmDialog';
export { LEGAL_DOCUMENTS } from './ui/DocumentPage';
export type { LegalDocument } from './ui/DocumentPage';
export { toDesignInset } from './ui/inset';
export type { DesignInset } from './ui/inset';
export {
    addButton,
    addLabel,
    addPanel,
    createNode,
    destroyNow,
    fillRect,
    getLayer,
    openModal,
    setButtonText,
    THEME,
    visibleSize,
} from './ui/kit';
export type { ButtonOptions, LabelOptions, LayerName, Modal } from './ui/kit';
export { SafeTopAdapter } from './ui/SafeTopAdapter';
export { Settings } from './ui/Settings';
