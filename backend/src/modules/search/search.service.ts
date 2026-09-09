import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PublicSearchQueryDto } from './dto/public-search.dto';

// Helper to calculate distance in km using Haversine Formula
function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Radius of Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public Network Search for Medicines with Generic Alternatives and Pharmacy Privacy Controls
   */
  async searchPublicNetwork(query: PublicSearchQueryDto) {
    const { q, governorate, district, userLat, userLng, only24Hours, limit = 50 } = query;

    const term = (q || '').trim();
    const hasCoordinates = userLat !== undefined && userLng !== undefined;
    const is24h = Boolean(only24Hours);

    if (!term && !governorate && !district && !hasCoordinates && !is24h) {
      return {
        query: { q, governorate, district },
        count: 0,
        results: [],
        alternatives: [],
      };
    }

    // 1. Base Where condition for available medicines in active visible pharmacies
    const where: any = {
      isAvailable: true,
      tenant: {
        isSearchVisible: true,
        subscriptionStatus: 'ACTIVE',
      },
    };

    if (governorate && governorate.trim().length > 0) {
      where.governorate = { contains: governorate.trim(), mode: 'insensitive' };
    }

    if (district && district.trim().length > 0) {
      where.district = { contains: district.trim(), mode: 'insensitive' };
    }

    if (is24h) {
      where.is24Hours = true;
    }

    if (term.length > 0) {
      where.OR = [
        { tradeName: { contains: term, mode: 'insensitive' } },
        { scientificName: { contains: term, mode: 'insensitive' } },
        { medicine: { barcode: { contains: term, mode: 'insensitive' } } },
      ];
    }

    // 2. Fetch Primary Search Matches
    const rawResults = await this.prisma.centralSearchIndex.findMany({
      where,
      take: Math.min(Number(limit) * 2, 100),
      include: {
        medicine: {
          select: {
            dosageForm: true,
            strength: true,
            manufacturer: true,
            barcode: true,
          },
        },
      },
    });

    // 3. Format primary results with Privacy Masking & Distance
    const formatItem = (item: any) => {
      let distanceKm: number | null = null;
      let distanceText: string | null = null;

      if (
        userLat !== undefined &&
        userLng !== undefined &&
        item.latitude &&
        item.longitude
      ) {
        distanceKm = calculateHaversineDistance(
          Number(userLat),
          Number(userLng),
          Number(item.latitude),
          Number(item.longitude),
        );
        if (distanceKm < 1) {
          distanceText = `${Math.round(distanceKm * 1000)} متر`;
        } else {
          distanceText = `${distanceKm.toFixed(1)} كم`;
        }
      }

      const showPrice = item.showSellingPrices !== false;
      const showPhone = item.showPhoneNumber !== false;
      const showWa = item.showWhatsapp !== false;

      // Clean phone for WhatsApp Link (e.g. 07801234567 -> 9647801234567)
      let whatsappUrl: string | null = null;
      if (showWa && item.phone) {
        let cleanPhone = item.phone.replace(/[^0-9]/g, '');
        if (cleanPhone.startsWith('0')) {
          cleanPhone = '964' + cleanPhone.slice(1);
        } else if (!cleanPhone.startsWith('964')) {
          cleanPhone = '964' + cleanPhone;
        }
        const textMsg = encodeURIComponent(
          `السلام عليكم، هل دواء (${item.tradeName}) متوفر لديكم في الصيدلية؟`,
        );
        whatsappUrl = `https://wa.me/${cleanPhone}?text=${textMsg}`;
      }

      const googleMapsNavigationUrl =
        item.latitude && item.longitude
          ? `https://www.google.com/maps/dir/?api=1&destination=${item.latitude},${item.longitude}`
          : item.googleMapsUrl ||
            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              item.pharmacyName + ' ' + item.governorate + ' ' + item.district,
            )}`;

      return {
        id: item.id,
        tenantId: item.tenantId,
        medicineId: item.medicineId,
        pharmacyName: item.pharmacyName,
        governorate: item.governorate,
        district: item.district,
        addressDetails: item.addressDetails || '',
        googleMapsUrl: googleMapsNavigationUrl,
        latitude: item.latitude,
        longitude: item.longitude,
        phone: showPhone ? item.phone : null,
        whatsappUrl,
        tradeName: item.tradeName,
        scientificName: item.scientificName,
        dosageForm: item.dosageForm || item.medicine?.dosageForm || '',
        strength: item.strength || item.medicine?.strength || '',
        manufacturer: item.medicine?.manufacturer || '',
        barcode: item.medicine?.barcode || '',
        sellingPricePack: showPrice ? Number(item.sellingPricePack) : null,
        priceHidden: !showPrice,
        stockStatus: item.stockStatus || 'HIGH_STOCK',
        stockStatusText:
          item.stockStatus === 'LOW_STOCK' ? 'كمية محدودة ⚠️' : 'متوفر ✅',
        is24Hours: item.is24Hours || false,
        distanceKm,
        distanceText,
        lastSyncedAt: item.lastSyncedAt,
      };
    };

    let formattedResults = rawResults.map(formatItem);

    // Sort by distance if user coordinates provided, else tradeName
    if (userLat !== undefined && userLng !== undefined) {
      formattedResults.sort((a, b) => {
        if (a.distanceKm === null) return 1;
        if (b.distanceKm === null) return -1;
        return a.distanceKm - b.distanceKm;
      });
    } else {
      formattedResults.sort((a, b) => a.tradeName.localeCompare(b.tradeName));
    }

    // 4. Smart Generic Alternatives Engine
    // If user searched for a term, find other brands with the same scientific name and strength
    let alternatives: any[] = [];
    if (term.length > 0 && rawResults.length > 0) {
      const primaryScientificNames = Array.from(
        new Set(rawResults.map((r) => r.scientificName?.trim() || '').filter(Boolean)),
      );
      const matchedTradeNames = new Set(rawResults.map((r) => r.tradeName.toLowerCase()));

      if (primaryScientificNames.length > 0) {
        const altWhere: any = {
          isAvailable: true,
          tenant: {
            isSearchVisible: true,
            subscriptionStatus: 'ACTIVE',
          },
          scientificName: { in: primaryScientificNames, mode: 'insensitive' },
        };

        if (governorate && governorate.trim().length > 0) {
          altWhere.governorate = { contains: governorate.trim(), mode: 'insensitive' };
        }
        if (district && district.trim().length > 0) {
          altWhere.district = { contains: district.trim(), mode: 'insensitive' };
        }

        const rawAlts = await this.prisma.centralSearchIndex.findMany({
          where: altWhere,
          take: 50,
          include: {
            medicine: {
              select: {
                dosageForm: true,
                strength: true,
                manufacturer: true,
                barcode: true,
              },
            },
          },
        });

        // Filter out brands that were already in the primary result
        const filteredAlts = rawAlts.filter(
          (alt) => !matchedTradeNames.has(alt.tradeName.toLowerCase()),
        );

        alternatives = filteredAlts.map(formatItem);
        if (userLat !== undefined && userLng !== undefined) {
          alternatives.sort((a, b) => {
            if (a.distanceKm === null) return 1;
            if (b.distanceKm === null) return -1;
            return a.distanceKm - b.distanceKm;
          });
        }
      }
    }

    return {
      query: { q, governorate, district },
      count: formattedResults.length,
      results: formattedResults.slice(0, Number(limit)),
      alternativesCount: alternatives.length,
      alternatives: alternatives.slice(0, 30),
    };
  }

  private static locationsCache: { data: any[]; expiry: number } | null = null;

  /**
   * Get list of governorates and districts available in the network (Cached in-memory)
   */
  async getAvailableLocations() {
    const now = Date.now();
    if (SearchService.locationsCache && SearchService.locationsCache.expiry > now) {
      return SearchService.locationsCache.data;
    }

    const locations = await this.prisma.centralSearchIndex.findMany({
      where: {
        isAvailable: true,
        tenant: {
          isSearchVisible: true,
          subscriptionStatus: 'ACTIVE',
        },
      },
      select: {
        governorate: true,
        district: true,
      },
      distinct: ['governorate', 'district'],
    });

    SearchService.locationsCache = {
      data: locations,
      expiry: now + 5 * 60 * 1000, // 5 minutes cache
    };

    return locations;
  }

  /**
   * Get public live network stats for hero banner
   */
  async getPublicNetworkStats() {
    const [totalMedicines, totalPharmacies, onDutyPharmacies] = await Promise.all([
      this.prisma.centralSearchIndex.count({
        where: {
          isAvailable: true,
          tenant: { isSearchVisible: true, subscriptionStatus: 'ACTIVE' },
        },
      }),
      this.prisma.tenant.count({
        where: { isSearchVisible: true, subscriptionStatus: 'ACTIVE' },
      }),
      this.prisma.tenant.count({
        where: { isSearchVisible: true, subscriptionStatus: 'ACTIVE', is24Hours: true },
      }),
    ]);

    const locations = await this.getAvailableLocations();
    const governoratesCount = new Set(locations.map((l) => l.governorate).filter(Boolean)).size;

    return {
      totalMedicines,
      totalPharmacies,
      onDutyPharmacies,
      governoratesCount,
    };
  }
}
