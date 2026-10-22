import { createClient, getCurrentAppId } from '@tier0/sdk-v2';

// Inject TIER0_API_HOST, TIER0_API_KEY and the real APP_ID on the server.
const tier0 = createClient();

export async function readOrders(signal?: AbortSignal) {
  return tier0.uns.recordFind({ collectionId: 'orders', limit: 20 }, { signal });
}

export async function notifyCompletion(recipientUserId: string, orderId: string) {
  return tier0.notifications.send({
    recipientUserId,
    title: 'Order completed',
    content: `Order ${orderId} is complete.`,
    type: 'business',
    idempotencyKey: `order-${orderId}-completed`,
    sender: { type: 'app', id: getCurrentAppId() },
  });
}
