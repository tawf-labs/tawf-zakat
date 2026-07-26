"use client";

import { useState, useEffect } from "react";
import { useAccount, useDisconnect, useChainId, useSwitchChain } from "wagmi";
import { useConnectModal } from "@xellar/kit";
import { Button } from "@/components/ui/button";
import { Wallet, ChevronDown, LogOut, Copy, ExternalLink } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/components/providers/language-provider";

export function ConnectWalletButton() {
  const [mounted, setMounted] = useState(false);
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { open } = useConnectModal(); // XellarKit modal
  const chainId = useChainId();
  const { switchChain, chains } = useSwitchChain();
  const { toast } = useToast();
  const { t } = useLanguage();

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleCopyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      toast({
        title: t("wallet.addressCopied"),
        description: t("wallet.addressCopiedDesc"),
      });
    }
  };

  const handleViewExplorer = () => {
    if (address && chainId) {
      const currentChain = chains.find((c) => c.id === chainId);
      if (currentChain?.blockExplorers?.default) {
        window.open(
          `${currentChain.blockExplorers.default.url}/address/${address}`,
          "_blank"
        );
      }
    }
  };

  const handleDisconnect = () => {
    disconnect();
    localStorage.removeItem("access_token");
    toast({
      title: t("header.disconnect"),
      description: t("wallet.disconnectedDesc"),
    });
  };

  if (!mounted) {
    return (
      <Button variant="default" size="default" disabled>
        <Wallet className="mr-2 h-4 w-4" />
        {t("header.connectWallet")}
      </Button>
    );
  }

  if (!isConnected) {
    return (
      <Button variant="default" size="default" onClick={open}>
        <Wallet className="mr-2 h-4 w-4" />
        {t("header.connectWallet")}
      </Button>
    );
  }

  const currentChain = chains.find((c) => c.id === chainId);

  return (
    <div className="flex items-center gap-2">
      {/* Chain Selector */}
      {currentChain && chains.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              {currentChain.name}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {chains.map((chain) => (
              <DropdownMenuItem
                key={chain.id}
                onClick={() => switchChain({ chainId: chain.id })}
                disabled={chain.id === chainId}
                className="cursor-pointer"
              >
                <div className="flex items-center justify-between w-full">
                  <span>{chain.name}</span>
                  {chain.id === chainId && (
                    <span className="text-xs text-green-500">●</span>
                  )}
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Account Button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="default" size="default">
            <Wallet className="mr-2 h-4 w-4" />
            {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : t("wallet.connected")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-2">
            <p className="text-xs text-gray-500 mb-1">{t("dashboard.connectedWallet")}</p>
            <p className="text-sm font-mono">
              {address ? `${address.slice(0, 10)}...${address.slice(-8)}` : ""}
            </p>
          </div>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handleCopyAddress} className="cursor-pointer">
            <Copy className="mr-2 h-4 w-4" />
            {t("wallet.copyAddress")}
          </DropdownMenuItem>

          {currentChain?.blockExplorers?.default && (
            <DropdownMenuItem onClick={handleViewExplorer} className="cursor-pointer">
              <ExternalLink className="mr-2 h-4 w-4" />
              {t("wallet.viewOnExplorer")}
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={handleDisconnect}
            className="cursor-pointer text-red-600 focus:text-red-600"
          >
            <LogOut className="mr-2 h-4 w-4" />
            {t("header.disconnect")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}