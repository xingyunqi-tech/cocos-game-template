export const GAME_CORE_VERSION = '0.2.0';

export { GameRoot, CONFIG_LOAD_ATTEMPTS, CONFIG_PATH } from './boot/GameRoot';
export { BootPipeline, BootStepError } from './boot/BootPipeline';
export type { StepContext, StepOptions, StepResult, StepRun } from './boot/BootPipeline';
export { Lifecycle } from './boot/Lifecycle';
export { retry } from './boot/retry';
export { getEnv } from './config/env';
export { RemoteConfig } from './config/RemoteConfig';
export {
    bootPipeline,
    deviceSave,
    http,
    initGameCore,
    lifecycle,
    mockTransport,
    remoteConfig,
    setSaveUser,
    userSave,
} from './core';
export type { CoreRemoteSettings } from './core';
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
