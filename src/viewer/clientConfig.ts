/**
 * The client config table: every game version the builder knows, in one place, so a new product
 * code or install folder (such as Forever's launch values, unknown during its beta) can be added
 * here without other changes.
 */
export interface ClientProduct {
	/** The product code in .build.info, e.g. "wow_classic_beta". */
	product: string;
	/** What the version is called in menus. */
	name: string;
	/** The install folder under the World of Warcraft folder, where known. */
	folder?: string;
	/** The reference client the builder is built and tested against (§7.1.1); others are best-effort. */
	reference?: boolean;
}

/**
 * Known versions, the preferred ones first: the order ranks the Game version menu and which
 * version opens by default. Forever is the reference client; it is in beta at the time of
 * writing (product wow_classic_beta, folder _classic_beta_), with the launch product code and
 * folder name still to confirm (spec Q10).
 */
export const CLIENT_PRODUCTS: ClientProduct[] = [
	{ product: 'wow_classic_beta', name: 'Forever', folder: '_classic_beta_', reference: true },
	{ product: 'wow_classic_era', name: 'Classic', folder: '_classic_era_' },
	{ product: 'wow', name: 'Retail', folder: '_retail_' },
	{ product: 'wow_classic', name: 'MoP Classic', folder: '_classic_' },
	{ product: 'wow_anniversary', name: 'Classic Anniversary', folder: '_anniversary_' },
	{ product: 'wowt', name: 'Retail PTR', folder: '_ptr_' },
	{ product: 'wowxptr', name: 'Retail PTR (next patch)', folder: '_xptr_' },
	{ product: 'wow_beta', name: 'Retail Beta', folder: '_beta_' },
	{ product: 'wow_classic_ptr', name: 'MoP Classic PTR', folder: '_classic_ptr_' },
	{ product: 'wow_classic_era_ptr', name: 'Classic Era PTR', folder: '_classic_era_ptr_' },
];

/** What a game version is called, by its product code; unknown ones go by their code. */
export function productName(product: string): string {
	return CLIENT_PRODUCTS.find((p) => p.product === product)?.name ?? product;
}

/** Where a product ranks in menus and default choices: known ones in table order, the rest after. */
export function productRank(product: string): number {
	const i = CLIENT_PRODUCTS.findIndex((p) => p.product === product);
	return i < 0 ? CLIENT_PRODUCTS.length : i;
}

/** The reference client's product code: the version the builder opens by default. */
export const REFERENCE_PRODUCT = CLIENT_PRODUCTS.find((p) => p.reference)!.product;

/** Folder names to name in picker messages: the reference client's first, then the other classic ones. */
export function knownFolders(): string[] {
	const classic = CLIENT_PRODUCTS.filter((p) => p.folder && (p.reference || p.product.startsWith('wow_classic')));
	return [...new Set(classic.map((p) => p.folder!))];
}
