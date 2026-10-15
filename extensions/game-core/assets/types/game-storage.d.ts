declare global {
    namespace OopsFramework {
        interface TypedGameStorageKey {
            OopsFrameworkAudio: 'OopsFrameworkAudio';
            OopsFrameworkPromptSkip: 'OopsFrameworkPromptSkip';
        }
    }

    type GameStorageKey = OopsFramework.TypedGameStorageKey[keyof OopsFramework.TypedGameStorageKey];
}

export {};
