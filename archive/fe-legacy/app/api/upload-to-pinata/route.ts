import { NextRequest, NextResponse } from 'next/server';
import { PinataSDK } from 'pinata-web3';

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT || '',
  pinataGateway: process.env.NEXT_PUBLIC_PINATA_GATEWAY || 'gateway.pinata.cloud',
});

export async function POST(request: NextRequest) {
  try {
    if (!process.env.PINATA_JWT) {
      return NextResponse.json(
        { error: 'PINATA_JWT not configured' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Upload to Pinata
    const upload = await pinata.upload.file(file);
    
    // Format gateway URL properly
    const gatewayDomain = process.env.NEXT_PUBLIC_PINATA_GATEWAY || 'gateway.pinata.cloud';
    const gatewayUrl = `https://${gatewayDomain.replace(/^https?:\/\//, '')}`;
    const url = `${gatewayUrl}/ipfs/${upload.IpfsHash}`;

    console.log(`Uploaded to Pinata: ${url}`);

    return NextResponse.json({
      success: true,
      url,
      ipfsHash: upload.IpfsHash,
    });
  } catch (error) {
    console.error('Error uploading to Pinata:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to upload file',
      },
      { status: 500 }
    );
  }
}
