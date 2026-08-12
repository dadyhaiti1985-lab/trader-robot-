/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("bot_config");
  collection.indexes.push("CREATE UNIQUE INDEX idx_bot_config_userId ON bot_config (userId)");
  return app.save(collection);
}, (app) => {
  try {
  const collection = app.findCollectionByNameOrId("bot_config");
  collection.indexes = collection.indexes.filter(idx => !idx.includes("idx_bot_config_userId"));
  return app.save(collection);
  } catch (e) {
    if (e.message.includes("no rows in result set")) {
      console.log("Collection not found, skipping revert");
      return;
    }
    throw e;
  }
})