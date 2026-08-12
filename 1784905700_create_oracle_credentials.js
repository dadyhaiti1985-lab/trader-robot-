/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const collection = new Collection({
      type: "base",
      name: "oracle_credentials",
      // Owner-only: only the user who owns the credentials can read/write them.
      // Values stored here are AES-256-GCM ciphertext produced server-side by
      // Express (apps/api) — the raw API key/secret never touch PocketBase or
      // the frontend in plaintext.
      listRule: "@request.auth.id != '' && @request.auth.id = owner",
      viewRule: "@request.auth.id != '' && @request.auth.id = owner",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          name: "owner",
          type: "relation",
          required: true,
          maxSelect: 1,
          collectionId: users.id,
          cascadeDelete: true,
        },
        { name: "exchange", type: "text", required: true, max: 60 },
        { name: "apiKeyCipher", type: "text", required: false, max: 4000 },
        { name: "apiSecretCipher", type: "text", required: false, max: 4000 },
        { name: "maxRiskPercent", type: "number", required: false, min: 0, max: 100 },
        { name: "stopLossPercent", type: "number", required: false, min: 0, max: 100 },
        { name: "takeProfitPercent", type: "number", required: false, min: 0, max: 100 },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_oracle_credentials_owner ON oracle_credentials (owner)"],
    });
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("oracle_credentials");
    app.delete(collection);
  },
);
