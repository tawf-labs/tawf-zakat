import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Only initialize if environment variables are available
// This allows the app to work without Supabase for main features
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  : null;

interface CertificateRequest {
  donorAddress: string;
  poolId: number;
  amount: number;
  campaignTitle: string;
  campaignType: string;
  transactionHash: string;
  timestamp: number;
}

export async function POST(request: NextRequest) {
  try {
    // Check if Supabase is configured
    if (!supabase) {
      return NextResponse.json(
        {
          success: false,
          error: 'Certificate service not configured',
          message: 'This feature requires database configuration',
        },
        { status: 503 }
      );
    }

    const body: CertificateRequest = await request.json();

    // Validate required fields
    if (!body.donorAddress || !body.poolId || !body.amount || !body.transactionHash) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Generate certificate ID
    const certificateId = `ZAKAT-${Date.now()}-${body.poolId}`;

    // Calculate certificate expiry (1 year from now)
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    // Save certificate to Supabase
    const { data, error } = await supabase
      .from('zakat_certificates')
      .insert([
        {
          certificate_id: certificateId,
          donor_address: body.donorAddress,
          pool_id: body.poolId,
          amount: body.amount,
          campaign_title: body.campaignTitle,
          campaign_type: body.campaignType,
          transaction_hash: body.transactionHash,
          timestamp: new Date(body.timestamp * 1000).toISOString(),
          expires_at: expiresAt.toISOString(),
          certificate_url: `https://zakat.zkt.io/certificates/${certificateId}`, // Mock URL
        },
      ])
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to save certificate' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        certificate: {
          id: certificateId,
          downloadUrl: `/api/certificates/${certificateId}/download`,
          expiresAt: expiresAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Certificate generation error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate certificate',
      },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve certificates by donor address
export async function GET(request: NextRequest) {
  try {
    if (!supabase) {
      return NextResponse.json(
        {
          success: false,
          error: 'Certificate service not configured',
          certificates: [],
        },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const donorAddress = searchParams.get('address');

    if (!donorAddress) {
      return NextResponse.json(
        { success: false, error: 'Missing address parameter' },
        { status: 400 }
      );
    }

    // Fetch certificates for this donor
    const { data, error } = await supabase
      .from('zakat_certificates')
      .select('*')
      .eq('donor_address', donorAddress)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch certificates' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      certificates: data || [],
    });
  } catch (error) {
    console.error('Fetch certificates error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch certificates',
      },
      { status: 500 }
    );
  }
}
