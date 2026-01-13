declare const convoManager: {
  isOtherAgent: (username: string) => boolean;
  responseScheduledFor: (username: string) => boolean;
  inConversation?: (username: string) => boolean;
  sendToBot?: (username: string, message: any) => void;
};
export default convoManager;


