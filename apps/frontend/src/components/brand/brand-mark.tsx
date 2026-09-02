import Image from 'next/image';
import { BRAND_ASSETS } from '@/lib/brand-assets';
import { cn } from '@/lib/utils';

export function BrandMark({
  className,
  priority = false,
  variant = 'solid',
}: {
  className?: string;
  priority?: boolean;
  variant?: 'solid' | 'transparent';
}) {
  return (
    <span className={cn('relative block h-8 w-8 flex-none', className)} aria-hidden="true">
      <Image
        src={variant === 'transparent' ? BRAND_ASSETS.transparentMark : BRAND_ASSETS.mark}
        alt=""
        width={32}
        height={32}
        unoptimized
        priority={priority}
        sizes="32px"
        className={cn(
          'pointer-events-none h-full w-full select-none object-contain',
          variant === 'solid' && 'rounded-[6px]',
        )}
      />
    </span>
  );
}
