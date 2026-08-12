/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("botConfig");

  const existing = collection.fields.getByName("stopLoss");
  if (existing) {
    if (existing.type === "number") {
      return; // field already exists with correct type, skip
    }
    collection.fields.removeByName("stopLoss"); // exists with wrong type, remove first
  }

  collection.fields.add(new NumberField({
    name: "stopLoss",
    required: true,
    min: 0.1
  }));

  return app.save(collection);
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("botConfig");
    collection.fields.removeByName("stopLoss");
    return app.save(collection);
  } catch (e) {
    if (e.message.includes("no rows in result set")) {
      console.log("Collection not found, skipping revert");
      return;
    }
    throw e;
  }
})