import { Annotation } from '@langchain/langgraph';

export const MessageState = Annotation.Root({
  source: Annotation<string>({ reducer: (_x, y) => y }),
  rawMessage: Annotation<string>({ reducer: (_x, y) => y }),
  messageEn: Annotation<string>({ reducer: (_x, y) => y ?? '' }),

  selfPrompt: Annotation<boolean>({ reducer: (_x, y) => y ?? false }),
  fromOtherBot: Annotation<boolean>({ reducer: (_x, y) => y ?? false }),

  maxResponses: Annotation<number>({ reducer: (_x, y) => y ?? 1 }),
  responsesSoFar: Annotation<number>({ reducer: (x, y) => y ?? x ?? 0 }),

  done: Annotation<boolean>({ reducer: (_x, y) => y ?? false }),
  usedCommand: Annotation<boolean>({ reducer: (x, y) => y ?? x ?? false }),

  isComplex: Annotation<boolean>({ reducer: (_x, y) => y ?? false }),
});


