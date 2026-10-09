// Pure adapters for the parts of Mealie's API that vary between releases.
// Keeping these transforms side-effect free makes request contracts testable.

export const slugifyTaxonomyName = (name) => String(name || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

export const taxonomyForSave = (item) => item && ({
  id: item.id,
  name: item.name,
  slug: item.slug || slugifyTaxonomyName(item.name),
});

export const relationForSave = (relation) => {
  if (!relation) return null;
  const name = typeof relation.name === "string" ? relation.name.trim() : "";
  if (relation.id) return { id: relation.id, name: name || relation.name };
  return name ? { name } : null;
};

export const substitutionForSave = (substitution) => {
  const substituteFoodId = substitution?.substituteFoodId || substitution?.substitute_food_id
    || substitution?.substituteFood?.id || substitution?.substitute_food?.id || null;
  const note = typeof substitution?.note === "string" && substitution.note.trim()
    ? substitution.note.trim()
    : substitution?.substituteFood?.name || substitution?.substitute_food?.name || "";
  return {
    ...(substituteFoodId ? { substituteFoodId } : {}),
    ...(note ? { note } : {}),
  };
};

export const ingredientForSave = (ingredient) => ({
  ...ingredient,
  food: relationForSave(ingredient.food),
  unit: relationForSave(ingredient.unit),
  substitutions: (ingredient.substitutions || []).map(substitutionForSave)
    .filter(sub => sub.substituteFoodId || sub.note),
});

export const normalizeRecipe = (recipe) => ({
  ...recipe,
  dateAdded: recipe.dateAdded ?? recipe.date_added,
  dateUpdated: recipe.dateUpdated ?? recipe.date_updated,
  lastMade: recipe.lastMade ?? recipe.last_made,
  recipeCategory: recipe.recipeCategory ?? recipe.recipe_category ?? [],
  recipeIngredient: recipe.recipeIngredient ?? recipe.recipe_ingredient ?? [],
  tags: recipe.tags ?? [],
});

export const normalizeRecipePage = (page) => ({
  ...page,
  items: (page?.items || []).map(normalizeRecipe),
  total: page?.total ?? page?.total_count,
  totalPages: page?.totalPages ?? page?.total_pages,
});

export const recipeIdFilter = (ids) => {
  const values = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
  return `id IN [${values.map(id => JSON.stringify(id)).join(", ")}]`;
};

export const cookbookPayload = ({ name, description = "", public: isPublic = false, recipeIds = [] }) => ({
  name,
  description,
  public: Boolean(isPublic),
  queryFilterString: recipeIdFilter(recipeIds),
});

export const normalizeAiSuggestions = (value) => (Array.isArray(value) ? value : [])
  .flat(Infinity)
  .filter(s => s && typeof s === "object" && typeof s.name === "string" && s.name.trim());
