import { Annotation } from '@langchain/langgraph';
export const MessageState = Annotation.Root({
    source: Annotation({ reducer: (_x, y) => y }),
    rawMessage: Annotation({ reducer: (_x, y) => y }),
    messageEn: Annotation({ reducer: (_x, y) => y ?? '' }),
    selfPrompt: Annotation({ reducer: (_x, y) => y ?? false }),
    fromOtherBot: Annotation({ reducer: (_x, y) => y ?? false }),
    maxResponses: Annotation({ reducer: (_x, y) => y ?? 1 }),
    responsesSoFar: Annotation({ reducer: (x, y) => y ?? x ?? 0 }),
    done: Annotation({ reducer: (_x, y) => y ?? false }),
    usedCommand: Annotation({ reducer: (x, y) => y ?? x ?? false }),
    isComplex: Annotation({ reducer: (_x, y) => y ?? false }),
});
