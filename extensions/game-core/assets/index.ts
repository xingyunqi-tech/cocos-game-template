export const GAME_CORE_VERSION = '2.3.1-dev';

export { GameRoot } from './boot/GameRoot';
export { BootPipeline, BootStepError } from './boot/BootPipeline';
export type { StepContext, StepOptions, StepResult, StepRun } from './boot/BootPipeline';
export { Lifecycle } from './boot/Lifecycle';
export type { UserReadyListener, UserState } from './boot/Lifecycle';
export { retry } from './boot/retry';
export { getEnv } from './config/env';
export { RemoteConfig } from './config/RemoteConfig';
export type { InvalidRemoteValue, RemoteSettingsMap } from './config/RemoteConfig';
export { Tables, TableStore } from './config/Tables';
export { loadAsset, loadBundle, preloadBundle } from './config/Bundles';
export { SoundService } from './ui/Sound';
export type { SoundRef } from './ui/Sound';
export type { TableMap, TableName } from './config/Tables';
export {
    ads,
    appUpdate,
    auth,
    bootPipeline,
    checkStorageUsage,
    configureCore,
    fetchRemoteConfig,
    confirm,
    createPrivacyPrompt,
    coreOptions,
    coreText,
    coreUi,
    createDailyCounter,
    createDailyFlags,
    createLoginStreak,
    createWallet,
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
    mockTransport,
    network,
    onUserReady,
    payment,
    platform,
    releaseBundle,
    remoteConfig,
    serverTime,
    sound,
    sidebar,
    userSave,
} from './core';
export type {
    ConfirmProvider,
    CoreConfig,
    DocumentProvider,
    GameEntry,
    PrivacyPromptText,
    SettingsProvider,
    WalletOptions,
} from './core';
export { DailyCounter } from './daily/DailyCounter';
export type { DailyCounterData, DailyStoreOptions } from './daily/DailyCounter';
export { DailyFlags } from './daily/DailyFlags';
export type { DailyFlagsData } from './daily/DailyFlags';
export { LoginStreak } from './daily/LoginStreak';
export type { LoginStreakData, LoginStreakResult } from './daily/LoginStreak';
export { Wallet } from './daily/Wallet';
export type { WalletData, WalletListener } from './daily/Wallet';
export { dayNumber, isRollback, ROLLBACK_TOLERANCE_DAYS } from './daily/date';
export { createLogger, logHub } from './monitor/logger';
export type { LogLevel, LogRecord, LogSink, Logger } from './monitor/logger';
export { track, tracker } from './monitor/track';
export type { TrackEvent, TrackParams, TrackSink } from './monitor/track';
export { errorReporter, ErrorThrottle, reportError } from './monitor/errors';
export type { ErrorReport, ErrorSink, ErrorSource, ErrorThrottleOptions } from './monitor/errors';
export { HttpClient } from './net/HttpClient';
export type {
    BusinessResult,
    HttpClientOptions,
    HttpErrorListener,
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
export { migrate, SaveSlot, SaveStore } from './save/SaveStore';
export type { Migration, SaveStoreOptions, SlotOptions } from './save/SaveStore';
export { MemoryStore } from './save/KeyValueStore';
export type { KeyValueStore } from './save/KeyValueStore';
export { AdPolicy, DEFAULT_AD_POLICY } from './ads/AdPolicy';
export type { AdPolicyOptions } from './ads/AdPolicy';
export { AdService } from './ads/AdService';
export type { AdKind, AdServiceOptions, AdUnits, LateAdListener } from './ads/AdService';
export { AuthService } from './net/AuthService';
export type {
    AuthProtocol,
    AuthServiceOptions,
    AuthSession,
    LoginFallback,
    LoginOutcome,
    LoginRequest,
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
    IRecorder,
    ISidebar,
    LaunchOptions,
    LoginCredential,
    NetworkType,
    PlatformName,
    PrivacyHandler,
    PrivacySetting,
    RecorderOptions,
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
export { ORDER_MAX_AGE_MS, ORDER_QUERY_TIMEOUT_MS, PaymentService, unsupportedPayment } from './payment/Payment';
export type { LatePayListener } from './payment/Payment';
export type { IPayment, OrderStore, PayFailReason, PayHooks, PayItem, PayResult, PendingOrder } from './payment/types';
export { ServerTime } from './time/ServerTime';
export type { ServerTimeOptions } from './time/ServerTime';
