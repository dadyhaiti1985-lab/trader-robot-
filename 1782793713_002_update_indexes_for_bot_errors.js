/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("bot_errors");
  collection.indexes.push("CREATE INDEX idx_bot_errors_userId_timestamp ON bot_errors (userId, timestamp)");
  return app.save(collection);
}, (app) => {
  try {
  const collection = app.findCollectionByNameOrId("bot_errors");
  collection.indexes = collection.indexes.filter(idx => !idx.includes("idx_bot_errors_userId_timestamp"));
  return app.save(collection);
  } catch (e) {
    if (e.message.includes("no rows in result set")) {
      console.log("Collection not found, skipping revert");
      return;
    }
    throw e;
  }
})