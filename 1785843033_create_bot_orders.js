/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    let collection;
    try {
      collection = app.findCollectionByNameOrId("bot_orders");
    } catch (_) {
      collection = new Collection({
        type: "base",
        name: "bot_orders",
        listRule: "userId = @request.auth.id",
        viewRule: "userId = @request.auth.id",
        createRule: "@request.auth.id != ''",
        updateRule: "userId = @request.auth.id",
        deleteRule: "userId = @request.auth.id",
        fields: [
          { name: "userId",          type: "text",   required: true },
          { name: "pair",            type: "text",   required: true },
          { name: "side",            type: "text",   required: true },
          { name: "quantity",        type: "number", required: true, min: 0 },
          { name: "price",           type: "number", min: 0 },
          { name: "orderType",       type: "text",   required: true },
          { name: "status",          type: "text",   required: true },
          { name: "externalOrderId", type: "text" },
          { name: "signal",          type: "text" },
          { name: "confidence",      type: "number", min: 0, max: 100 },
          { name: "entryPrice",      type: "number", min: 0 },
          { name: "stopLoss",        type: "number", min: 0 },
          { name: "takeProfit",      type: "number", min: 0 },
          { name: "created",         type: "autodate", onCreate: true,  onUpdate: false },
          { name: "updated",         type: "autodate", onCreate: true,  onUpdate: true  },
        ],
        indexes: [
          "CREATE INDEX idx_bot_orders_user_pair   ON bot_orders (userId, pair)",
          "CREATE INDEX idx_bot_orders_user_status ON bot_orders (userId, status)",
          "CREATE INDEX idx_bot_orders_pair_status ON bot_orders (pair, status)",
        ],
      });
      app.save(collection);
    }
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId("bot_orders");
      app.delete(collection);
    } catch (_) {
      // already gone
    }
  },
);
