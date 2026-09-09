import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { decryptSecret } from '../../common/utils/security.util';
import { CreateMedicineDto, QueryMedicineDto } from './dto/create-medicine.dto';

@Injectable()
export class MedicinesService {
  private readonly logger = new Logger(MedicinesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Search medicines in Global Catalog by tradeName, scientificName, or barcode
   */
  async search(query: QueryMedicineDto) {
    const { q, barcode, limit = 30 } = query;
    const where: any = {};

    if (barcode) {
      where.barcode = barcode;
    } else if (q && q.trim().length > 0) {
      const searchTerm = q.trim();
      where.OR = [
        { tradeName: { contains: searchTerm, mode: 'insensitive' } },
        { scientificName: { contains: searchTerm, mode: 'insensitive' } },
        { barcode: { contains: searchTerm, mode: 'insensitive' } },
        { manufacturer: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    return this.prisma.medicine.findMany({
      where,
      take: Math.min(limit, 100),
      orderBy: { tradeName: 'asc' },
    });
  }

  /**
   * Get single medicine details
   */
  async findById(id: string) {
    const medicine = await this.prisma.medicine.findUnique({
      where: { id },
    });
    if (!medicine) {
      throw new NotFoundException('الدواء غير موجود في الدليل الموحد');
    }
    return medicine;
  }

  /**
   * Add a new medicine to the Global Catalog
   */
  async create(dto: CreateMedicineDto, isSuperAdmin: boolean = false) {
    // If barcode exists, check for duplicate
    if (dto.barcode) {
      const existing = await this.prisma.medicine.findFirst({
        where: { barcode: dto.barcode },
      });
      if (existing) {
        throw new ConflictException(`يوجد دواء مسجل مسبقاً بنفس الباركود: ${existing.tradeName}`);
      }
    }

    const medicine = await this.prisma.medicine.create({
      data: {
        tradeName: dto.tradeName.trim(),
        scientificName: dto.scientificName?.trim() || null,
        dosageForm: dto.dosageForm || null,
        strength: dto.strength || null,
        manufacturer: dto.manufacturer || null,
        barcode: dto.barcode?.trim() || null,
        defaultUnitsPerPack: dto.defaultUnitsPerPack || 1,
        isVerified: isSuperAdmin ? (dto.isVerified ?? true) : false,
        needsPackagingReview: !isSuperAdmin,
      },
    });

    return medicine;
  }

  /**
   * Get all master catalog medicines with filters & pagination for SuperAdmin
   */
  async getMasterCatalog(
    search?: string,
    filter: 'ALL' | 'VERIFIED' | 'UNVERIFIED' = 'ALL',
    page: number = 1,
    limit: number = 50,
  ) {
    const where: any = {};
    if (filter === 'UNVERIFIED') {
      where.isVerified = false;
    } else if (filter === 'VERIFIED') {
      where.isVerified = true;
    }

    if (search && search.trim().length > 0) {
      const q = search.trim();
      where.OR = [
        { tradeName: { contains: q, mode: 'insensitive' } },
        { scientificName: { contains: q, mode: 'insensitive' } },
        { barcode: { contains: q, mode: 'insensitive' } },
        { manufacturer: { contains: q, mode: 'insensitive' } },
      ];
    }

    const take = Math.min(100, Math.max(10, Number(limit) || 50));
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;

    const [items, total] = await Promise.all([
      this.prisma.medicine.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.medicine.count({ where }),
    ]);

    const totalUnverified = await this.prisma.medicine.count({
      where: { isVerified: false },
    });

    const totalVerified = await this.prisma.medicine.count({
      where: { isVerified: true },
    });

    return {
      items,
      total,
      totalVerified,
      totalUnverified,
      page: Math.max(1, Number(page) || 1),
      totalPages: Math.ceil(total / take),
      limit: take,
    };
  }

  /**
   * Update master medicine entry (SuperAdmin)
   */
  async updateMasterMedicine(id: string, dto: Partial<CreateMedicineDto>) {
    const existing = await this.prisma.medicine.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('الدواء غير موجود');
    }

    const updated = await this.prisma.medicine.update({
      where: { id },
      data: {
        ...(dto.tradeName ? { tradeName: dto.tradeName.trim() } : {}),
        ...(dto.scientificName ? { scientificName: dto.scientificName.trim() } : {}),
        ...(dto.dosageForm !== undefined ? { dosageForm: dto.dosageForm } : {}),
        ...(dto.strength !== undefined ? { strength: dto.strength } : {}),
        ...(dto.manufacturer !== undefined ? { manufacturer: dto.manufacturer } : {}),
        ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
        ...(dto.defaultUnitsPerPack ? { defaultUnitsPerPack: Number(dto.defaultUnitsPerPack) } : {}),
        ...(dto.isVerified !== undefined ? { isVerified: dto.isVerified } : {}),
      },
    });

    return {
      success: true,
      message: `تم تحديث بيانات الدواء (${updated.tradeName}) بنجاح`,
      medicine: updated,
    };
  }

  /**
   * Get list of unverified medicines submitted by pharmacies
   */
  async getUnverified(search?: string) {
    const where: any = { isVerified: false };
    if (search && search.trim().length > 0) {
      const q = search.trim();
      where.OR = [
        { tradeName: { contains: q, mode: 'insensitive' } },
        { scientificName: { contains: q, mode: 'insensitive' } },
        { barcode: { contains: q, mode: 'insensitive' } },
      ];
    }

    const items = await this.prisma.medicine.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const totalUnverified = await this.prisma.medicine.count({
      where: { isVerified: false },
    });

    const totalVerified = await this.prisma.medicine.count({
      where: { isVerified: true },
    });

    return {
      items,
      totalUnverified,
      totalVerified,
    };
  }

  /**
   * SuperAdmin approves/verifies a medicine into the global catalog
   */
  async verifyMedicine(id: string, updates?: Partial<CreateMedicineDto>) {
    const existing = await this.prisma.medicine.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('الدواء غير موجود');
    }

    const updated = await this.prisma.medicine.update({
      where: { id },
      data: {
        isVerified: true,
        ...(updates?.tradeName ? { tradeName: updates.tradeName } : {}),
        ...(updates?.scientificName ? { scientificName: updates.scientificName } : {}),
        ...(updates?.dosageForm ? { dosageForm: updates.dosageForm } : {}),
        ...(updates?.strength ? { strength: updates.strength } : {}),
        ...(updates?.manufacturer ? { manufacturer: updates.manufacturer } : {}),
        ...(updates?.defaultUnitsPerPack ? { defaultUnitsPerPack: updates.defaultUnitsPerPack } : {}),
      },
    });

    return {
      success: true,
      message: `تم اعتماد الدواء "${updated.tradeName}" رسمياً في الدليل الموحد`,
      medicine: updated,
    };
  }

  /**
   * SuperAdmin rejects/deletes a medicine
   */
  async deleteMedicine(id: string) {
    const existing = await this.prisma.medicine.findUnique({
      where: { id },
      include: {
        _count: {
          select: { searchIndexes: true },
        },
      },
    });
    if (!existing) {
      throw new NotFoundException('الدواء غير موجود');
    }

    if (existing._count?.searchIndexes > 0) {
      throw new BadRequestException(
        `لا يمكن حذف الدواء (${existing.tradeName}) لوجود صيدليات (${existing._count.searchIndexes}) تبيعه حالياً في مخزونها النشط. يرجى تعديل بياناته بدلاً من حذفه.`,
      );
    }

    await this.prisma.medicine.delete({ where: { id } });

    return {
      success: true,
      message: `تم حذف الدواء (${existing.tradeName}) بنجاح`,
    };
  }

  /**
   * Seed common essential medicines used in Iraqi pharmacies for instant testing
   */
  async seedInitialMedicines() {
    const count = await this.prisma.medicine.count();
    if (count > 0) {
      return { message: 'قاعدة بيانات الأدوية تحتوي على بيانات مسبقاً', count };
    }

    const sampleMedicines = [
      {
        tradeName: 'Panadol Extra',
        scientificName: 'Paracetamol 500mg + Caffeine 65mg',
        dosageForm: 'أقراص / حبوب',
        strength: '500mg/65mg',
        manufacturer: 'GSK',
        barcode: '5054563039835',
        defaultUnitsPerPack: 2, // 2 أشرطة بالعلبة (24 قرص)
      },
      {
        tradeName: 'Amoxil 500mg',
        scientificName: 'Amoxicillin',
        dosageForm: 'كبسول',
        strength: '500mg',
        manufacturer: 'GSK / SDI',
        barcode: '6281002938121',
        defaultUnitsPerPack: 2,
      },
      {
        tradeName: 'Augmentin 1g',
        scientificName: 'Amoxicillin + Clavulanic Acid',
        dosageForm: 'أقراص',
        strength: '1g (875/125mg)',
        manufacturer: 'GSK',
        barcode: '5000158068994',
        defaultUnitsPerPack: 2, // 14 قرص (شريطان)
      },
      {
        tradeName: 'Profen 400mg',
        scientificName: 'Ibuprofen',
        dosageForm: 'حبوب',
        strength: '400mg',
        manufacturer: 'Julphar / SDI',
        barcode: '6291007010452',
        defaultUnitsPerPack: 3, // 3 أشرطة
      },
      {
        tradeName: 'Cataflam 50mg',
        scientificName: 'Diclofenac Potassium',
        dosageForm: 'حبوب ملبسة',
        strength: '50mg',
        manufacturer: 'Novartis',
        barcode: '7680538910023',
        defaultUnitsPerPack: 2,
      },
      {
        tradeName: 'Flagyl 500mg',
        scientificName: 'Metronidazole',
        dosageForm: 'حبوب',
        strength: '500mg',
        manufacturer: 'Sanofi',
        barcode: '3582910034812',
        defaultUnitsPerPack: 2,
      },
      {
        tradeName: 'Nexium 40mg',
        scientificName: 'Esomeprazole',
        dosageForm: 'أقراص مقاومة للمعدة',
        strength: '40mg',
        manufacturer: 'AstraZeneca',
        barcode: '7323190014022',
        defaultUnitsPerPack: 2, // 28 قرص (شريطان)
      },
      {
        tradeName: 'Concor 5mg',
        scientificName: 'Bisoprolol Fumarate',
        dosageForm: 'حبوب',
        strength: '5mg',
        manufacturer: 'Merck',
        barcode: '4022536109923',
        defaultUnitsPerPack: 3,
      },
      {
        tradeName: 'Lipitor 20mg',
        scientificName: 'Atorvastatin Calcium',
        dosageForm: 'أقراص',
        strength: '20mg',
        manufacturer: 'Pfizer',
        barcode: '5415062301928',
        defaultUnitsPerPack: 3,
      },
      {
        tradeName: 'Ventolin Inhaler',
        scientificName: 'Salbutamol',
        dosageForm: 'بخاخ استنشاق',
        strength: '100mcg (200 doses)',
        manufacturer: 'GSK',
        barcode: '5000158019484',
        defaultUnitsPerPack: 1, // بخاخ واحد
      },
    ];

    await this.prisma.medicine.createMany({
      data: sampleMedicines,
    });

    this.logger.log(`Seeded ${sampleMedicines.length} initial medicines into Master DB.`);
    return { message: 'تم إدخال قائمة الأدوية الأولية بنجاح', count: sampleMedicines.length };
  }

  /**
   * Natural Language & Clinical Query Intent Search Engine powered by Gemini AI
   */
  async aiSmartSearch(userQuery: string, inStockOnly: boolean = false) {
    if (!userQuery || userQuery.trim().length === 0) {
      throw new BadRequestException('نص البحث فارغ');
    }

    const tenantId = this.tenantContext.getTenantId();
    const schemaName = this.tenantContext.getSchemaName();

    // 1. Get Tenant's Gemini API Key (or system key)
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { geminiApiKey: true, name: true },
    });

    let rawKey = tenant?.geminiApiKey?.trim();
    if (rawKey) {
      try {
        rawKey = decryptSecret(rawKey);
      } catch {
        // Fallback to existing
      }
    }
    const apiKey = rawKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new BadRequestException(
        'ميزة البحث الذكي باللغة الطبيعية والصوت تتطلب تفعيل مفتاح (Google Gemini API Key) في إعدادات الصيدلية.',
      );
    }

    // 2. Query Gemini for Clinical Intent Parsing
    const parsedIntent = await this.parseClinicalQueryIntent(apiKey, userQuery.trim());

    // 3. Execute Structured Search on Master DB & Pharmacy Inventory
    const results = await this.executeIntentSearch(schemaName, parsedIntent, userQuery.trim(), inStockOnly);

    return {
      success: true,
      originalQuery: userQuery.trim(),
      explanationAr: parsedIntent.explanationAr || 'نتائج البحث المطابقة للاستفسار',
      intentType: parsedIntent.intentType || 'GENERAL',
      parsedIntent,
      resultsCount: results.length,
      results,
    };
  }

  /**
   * Parse colloquial / natural language pharmacy query into clinical search schema
   */
  private async parseClinicalQueryIntent(apiKey: string, query: string): Promise<any> {
    const prompt = `
      You are an expert Clinical Pharmacologist and AI Search Engine for Iraqi and Arab pharmacies.
      Your job is to understand natural language pharmacy search queries (which could be in standard Arabic, Iraqi dialect, or English)
      and convert them into a structured medical intent search object in JSON format.

      Pharmacist Query: "${query}"

      Analyze the query:
      1. What is the clinical intent?
         - Is it looking for alternatives/substitutes (بديل)?
         - Is it looking by active ingredient (المادة الفعالة / الاسم العلمي e.g., Paracetamol, Amoxicillin, Ibuprofen, Omeprazole, etc.)?
         - Is it looking by therapeutic class/category (e.g. مضادات حيوية, أدوية ضغط, مسكنات ألم, أدوية سكر, خافض حرارة, مضاد حساسية, شراب كحة, قطرات عين)?
         - Is it targeting specific dosage form (أقراص/حبوب Tablet, شراب Syrup, معلق Suspension, قطرات Drops, تحاميل Suppository, حقن/أمبولات Ampoule/Injection, مرهم Ointment, كريم Cream)?
         - Is it targeting specific age/audience (أطفال Pediatric/Children, رضع Infant, كبار Adult)?
         - Is it asking about inventory status (المتوفر بالمخزن, نواقص, اللي راح تخلص)?
      2. If the user mentions any brand or active ingredient, provide a comprehensive list of ALL popular Middle Eastern and Iraqi brand names for that molecule:
         - Paracetamol: ["Panadol", "Adol", "Calpol", "Cetal", "Paramol", "Efferalgan", "Tempra", "Tylenol", "Doloraz", "Febradol", "Fevadol"]
         - Amoxicillin/Clavulanate: ["Augmentin", "Curam", "Megamox", "Klavox", "Amoclan", "Amoxiclav", "Julmentin", "Clavodar"]
         - Ibuprofen: ["Brufen", "Profen", "Advil", "Motrin", "Ibuprofen", "Ibufen"]
         - Cefixime: ["Suprax", "Magnacef", "Fixim", "Cefix", "Cefixime"]
         - Amoxicillin: ["Amoxil", "Amoxicillin", "Hiconcil", "Moxypen"]
         - Azithromycin: ["Zithromax", "Azitro", "Zomax", "Azibiotic"]
         - Metformin: ["Glucophage", "Metformin", "Formit", "Diaformin"]

      Return ONLY valid JSON matching this schema:
      {
        "explanationAr": "string (A friendly Arabic sentence explaining what was understood, e.g.: 'البحث عن أدوية تحتوي على باراسيتامول للأطفال على شكل شراب')",
        "intentType": "ALTERNATIVE" | "INGREDIENT" | "CATEGORY" | "STOCK_QUERY" | "GENERAL",
        "scientificName": "string (pure scientific molecule name in English e.g. 'Paracetamol' or 'Amoxicillin and clavulanate potassium' or empty)",
        "tradeNameKeywords": ["string", "string"], // array of popular brand names in Iraq/Arab region
        "dosageForms": ["string"], // e.g. ["Syrup", "Suspension"] or ["Tablet"] or empty if any
        "targetAudience": "PEDIATRIC" | "ADULT" | "INFANT" | "ALL",
        "strength": "string (e.g. '500mg' or '1g' or empty)",
        "therapeuticCategory": "string (e.g. 'Antibiotic', 'Analgesic', 'Antidiabetic', 'Antihypertensive', 'Antihistamine', 'Cough', or empty)",
        "inStockOnly": false,
        "lowStockOnly": false
      }

      Return ONLY the JSON object. No backticks, no markdown.
    `;

    const models = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-pro', 'gemini-pro-latest'];
    for (const model of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json',
              },
            }),
          },
        );

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini API Error (${response.status}): ${errText}`);
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
        const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);
      } catch (err: any) {
        this.logger.warn(`Gemini model ${model} failed for intent parsing: ${err.message}`);
      }
    }

    throw new BadRequestException('فشل معالجة استفسار البحث بالذكاء الاصطناعي، يرجى المحاولة مرة أخرى.');
  }

  /**
   * Execute structured PostgreSQL query against Master DB and tenant inventory
   */
  private async executeIntentSearch(
    schemaName: string,
    intent: any,
    userQuery: string,
    forceInStock: boolean = false,
  ): Promise<any[]> {
    const FORM_SYNONYMS: Record<string, string[]> = {
      syrup: ['syrup', 'susp', 'suspension', 'شراب', 'معلق', 'liquid', 'elixir', 'drops', 'قطرات'],
      suspension: ['susp', 'suspension', 'syrup', 'معلق', 'شراب'],
      drops: ['drops', 'drop', 'قطرة', 'قطرات', 'نقط'],
      tablet: ['tablet', 'tab', 'قرص', 'أقراص', 'اقراص', 'حبوب', 'حبة', 'ملبسة'],
      capsule: ['capsule', 'cap', 'كبسول', 'كبسولة', 'كبسولات'],
      ampoule: ['ampoule', 'amp', 'inj', 'injection', 'حقن', 'أمبول', 'امبول', 'فيال', 'vial'],
      cream: ['cream', 'كريم', 'مرهم', 'ointment', 'gel', 'جل'],
      ointment: ['ointment', 'مرهم', 'cream', 'كريم', 'gel'],
      inhaler: ['inhaler', 'بخاخ', 'استنشاق', 'aer', 'spray'],
      suppository: ['suppository', 'supp', 'تحاميل', 'تحميلة', 'لبوس'],
    };

    // 1. Build expanded form keywords
    const formKeywords: string[] = [];
    if (Array.isArray(intent.dosageForms)) {
      for (const f of intent.dosageForms) {
        if (typeof f === 'string') {
          const key = f.toLowerCase();
          if (FORM_SYNONYMS[key]) {
            formKeywords.push(...FORM_SYNONYMS[key]);
          } else {
            formKeywords.push(f.toLowerCase());
          }
        }
      }
    }

    // 2. Extract meaningful tokens from query
    const rawTokens = userQuery
      .replace(/[^\w\s\u0600-\u06FF]/gi, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !['أريد', 'عندي', 'اريد', 'بالمخزن', 'شكل', 'ادوية', 'أدوية', 'دواء'].includes(t));

    // 3. Collect molecule and brand search terms
    const searchTerms = Array.from(new Set([
      intent.scientificName,
      ...(intent.tradeNameKeywords || []),
      ...rawTokens,
    ])).filter((t: any) => typeof t === 'string' && t.trim().length > 1) as string[];

    const params: any[] = [];
    let paramIdx = 1;

    // A. Molecule / Brand / Token Matching (OR combination for maximum recall)
    let termMatchSql = '1=1';
    if (searchTerms.length > 0) {
      const termClauses = searchTerms.map(t => {
        params.push(`%${t}%`);
        return `(m.scientific_name ILIKE $${paramIdx} OR m.trade_name ILIKE $${paramIdx} OR COALESCE(i.custom_name, '') ILIKE $${paramIdx++})`;
      });
      termMatchSql = `(${termClauses.join(' OR ')})`;
    }

    // B. Dosage Form matching
    let formMatchSql = '1=1';
    let hasFormFilter = false;
    if (formKeywords.length > 0) {
      hasFormFilter = true;
      const formClauses = formKeywords.map(fk => {
        params.push(`%${fk}%`);
        return `(COALESCE(m.dosage_form, '') ILIKE $${paramIdx} OR m.trade_name ILIKE $${paramIdx} OR COALESCE(i.custom_name, '') ILIKE $${paramIdx++})`;
      });
      formMatchSql = `(${formClauses.join(' OR ')})`;
    }

    // C. Pediatric / Child audience filter
    if (intent.targetAudience === 'PEDIATRIC' || userQuery.includes('أطفال') || userQuery.includes('رضع')) {
      params.push('%baby%');
      const p1 = paramIdx++;
      params.push('%ped%');
      const p2 = paramIdx++;
      params.push('%أطفال%');
      const p3 = paramIdx++;
      params.push('%child%');
      const p4 = paramIdx++;
      formMatchSql = `(${formMatchSql} OR m.trade_name ILIKE $${p1} OR m.trade_name ILIKE $${p2} OR COALESCE(m.dosage_form, '') ILIKE $${p3} OR m.trade_name ILIKE $${p4})`;
    }

    let sql = `
      SELECT 
        m.id,
        COALESCE(i.custom_name, m.trade_name) as "tradeName",
        m.trade_name as "originalTradeName",
        m.scientific_name as "scientificName",
        m.dosage_form as "dosageForm",
        m.strength as "strength",
        m.manufacturer as "manufacturer",
        m.barcode as "barcode",
        COALESCE(i.units_per_pack, m.default_units_per_pack, 1) as "unitsPerPack",
        i.shelf_location as "shelfLocation",
        COALESCE(i.selling_price_pack, 0) as "sellingPricePack",
        COALESCE(i.selling_price_unit, 0) as "sellingPriceUnit",
        COALESCE(SUM(b.quantity_units_remaining), 0)::int as "totalUnitsRemaining",
        FLOOR(COALESCE(SUM(b.quantity_units_remaining), 0) / COALESCE(i.units_per_pack, m.default_units_per_pack, 1))::int as "availablePacks",
        (COALESCE(SUM(b.quantity_units_remaining), 0) % COALESCE(i.units_per_pack, m.default_units_per_pack, 1))::int as "availableStrips",
        CASE WHEN COALESCE(SUM(b.quantity_units_remaining), 0) > 0 THEN true ELSE false END as "inStock"
      FROM public.medicines m
      LEFT JOIN "${schemaName}".inventory_items i ON m.id = i.medicine_id
      LEFT JOIN "${schemaName}".inventory_batches b ON i.id = b.inventory_item_id
      WHERE ${termMatchSql} ${hasFormFilter ? `AND ${formMatchSql}` : ''}
      GROUP BY m.id, i.id
    `;

    if (forceInStock || intent.inStockOnly) {
      sql += ` HAVING COALESCE(SUM(b.quantity_units_remaining), 0) > 0`;
    }

    sql += `
      ORDER BY 
        CASE WHEN COALESCE(SUM(b.quantity_units_remaining), 0) > 0 THEN 0 ELSE 1 END,
        m.trade_name ASC
      LIMIT 40;
    `;

    return this.prisma.$queryRawUnsafe(sql, ...params);
  }
}
